import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const collectorRoot = path.resolve("D:\\UbonCity_Web\\collector");
const indexHtml = fs.readFileSync(path.join(collectorRoot, "server", "public", "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "app.js"), "utf8");
const cleanItemHtml = fs.readFileSync(path.join(collectorRoot, "server", "public", "clean-item.html"), "utf8");
const itemEditorHtml = fs.readFileSync(path.join(collectorRoot, "server", "public", "item-editor.html"), "utf8");
const itemEditorJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "item-editor.js"), "utf8");
const themeBootstrapJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "theme-bootstrap.js"), "utf8");
const themeControlJs = fs.readFileSync(path.join(collectorRoot, "server", "public", "theme-control.js"), "utf8");
const indexServer = fs.readFileSync(path.join(collectorRoot, "server", "index.mjs"), "utf8");
const stylesCss = fs.readFileSync(path.join(collectorRoot, "server", "public", "styles.css"), "utf8");
const repositoryJs = fs.readFileSync(path.join(collectorRoot, "db", "repository.mjs"), "utf8");

function extractNamedFunctionSource(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract function ${name}`);
}

function parseJsonForTest(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }
  return value;
}

const getAssignmentAssigneeLabel = new Function(
  `${extractNamedFunctionSource(appJs, "getAssignmentAssigneeLabel")}; return getAssignmentAssigneeLabel;`
)();

const canActOnAssignmentWorkForTest = new Function(
  "state",
  `${extractNamedFunctionSource(appJs, "canActOnAssignmentWork")}; return canActOnAssignmentWork;`
);

const getManagerUsersForTest = new Function(
  "state",
  `${extractNamedFunctionSource(appJs, "getManagerUsers")}; return getManagerUsers;`
);

const resolvePreferredTabForTest = new Function(
  "getDefaultAssignmentPageMode",
  "state",
  `${extractNamedFunctionSource(appJs, "resolvePreferredTab")}; return resolvePreferredTab;`
);

const getDefaultAssignmentPageModeForTest = new Function(
  "currentRole",
  "isAssignmentWorkOnlyUser",
  `${extractNamedFunctionSource(appJs, "getDefaultAssignmentPageMode")}; return getDefaultAssignmentPageMode;`
);

const normalizeAssignmentSubmissionArticlePayloadForTest = new Function(
  "parseJsonSafe",
  "getFieldPackPromptGroups",
  `${extractNamedFunctionSource(appJs, "normalizeAssignmentSubmissionPromptAnswers")}
${extractNamedFunctionSource(appJs, "normalizeAssignmentSubmissionEditorialPayload")}
return normalizeAssignmentSubmissionEditorialPayload;`
)(
  parseJsonForTest,
  (fieldPack) => ({
    mustVerify: Array.isArray(fieldPack?.must_verify_facts_json) ? fieldPack.must_verify_facts_json : [],
    mustAsk: Array.isArray(fieldPack?.must_ask_questions_json) ? fieldPack.must_ask_questions_json : [],
  })
);

const normalizeAssignmentRowForTest = new Function(
  "parseJson",
  `${extractNamedFunctionSource(repositoryJs, "normalizeAssignmentRow")}; return normalizeAssignmentRow;`
)(parseJsonForTest);

function loadAssignmentManagementScopeHooks(users = [], options = {}) {
  const userMap = new Map(
    (Array.isArray(users) ? users : []).map((row) => [Number(row?.id || 0), {
      id: Number(row?.id || 0) || 0,
      role: String(row?.role || "").trim().toLowerCase(),
      managed_by_user_id: Number(row?.managed_by_user_id || 0) || 0,
    }])
  );
  const itemMap = new Map(
    (Array.isArray(options?.items) ? options.items : []).map((row) => [Number(row?.id || 0), { ...row, id: Number(row?.id || 0) || 0 }])
  );
  const assignmentsByItemId = new Map();
  (Array.isArray(options?.assignments) ? options.assignments : []).forEach((row) => {
    const itemId = Number(row?.content_item_id || row?.item_id || 0) || 0;
    if (!itemId) return;
    if (!assignmentsByItemId.has(itemId)) assignmentsByItemId.set(itemId, []);
    assignmentsByItemId.get(itemId).push(row);
  });
  const context = {
    db: {
      prepare(sql) {
        return {
          get(...args) {
            if (/SELECT role FROM users/i.test(sql)) {
              const row = userMap.get(Number(args[0] || 0));
              return row ? { role: row.role } : undefined;
            }
            if (/role IN \('freelance', 'editor'\) AND managed_by_user_id=\?/i.test(sql)) {
              const workerId = Number(args[0] || 0) || 0;
              const managerId = Number(args[1] || 0) || 0;
              const row = userMap.get(workerId);
              if (!row || !["freelance", "editor"].includes(row.role)) return undefined;
              return row.managed_by_user_id === managerId ? { id: row.id } : undefined;
            }
            if (/SELECT id, managed_by_user_id FROM users WHERE id=\?/i.test(sql)) {
              const row = userMap.get(Number(args[0] || 0));
              return row ? { id: row.id, managed_by_user_id: row.managed_by_user_id } : undefined;
            }
            return undefined;
          },
        };
      },
    },
    repo: {
      getItem(itemId) {
        return itemMap.get(Number(itemId || 0)) || null;
      },
      listAssignmentsByItem(itemId) {
        return assignmentsByItemId.get(Number(itemId || 0)) || [];
      },
    },
    normalizeUserRole(value, fallback = "user") {
      const normalized = String(value || "").trim().toLowerCase();
      return normalized || fallback;
    },
    normalizePolicyRole(value, fallback = "user") {
      const normalized = String(value || "").trim().toLowerCase();
      return normalized || fallback;
    },
    console,
  };
  const source = `
${extractNamedFunctionSource(indexServer, "actorPolicyRole")}
${extractNamedFunctionSource(indexServer, "isManagedContributorByUser")}
${extractNamedFunctionSource(indexServer, "getUserAssignmentRole")}
${extractNamedFunctionSource(indexServer, "isOwnerUser")}
${extractNamedFunctionSource(indexServer, "getAuthUserId")}
${extractNamedFunctionSource(indexServer, "canAssignToUserByManagementLine")}
${extractNamedFunctionSource(indexServer, "canSeeUserByManagementLine")}
${extractNamedFunctionSource(indexServer, "canSeeManagedWorkForUser")}
${extractNamedFunctionSource(indexServer, "canSeeAssignmentByManagementLine")}
${extractNamedFunctionSource(indexServer, "filterAssignmentsByManagementLine")}
${extractNamedFunctionSource(indexServer, "canClaimItemByManagementLine")}
${extractNamedFunctionSource(indexServer, "canTakeOverItemByManagementLine")}
${extractNamedFunctionSource(indexServer, "canMutateItemByManagementLine")}
${extractNamedFunctionSource(indexServer, "hasAssignmentAccess")}
${extractNamedFunctionSource(indexServer, "hasAssignmentSubmissionAccess")}
${extractNamedFunctionSource(indexServer, "listEditorialAssignmentsByItem")}
${extractNamedFunctionSource(indexServer, "getPrimaryEditorialAssignment")}
${extractNamedFunctionSource(indexServer, "hasItemBriefAccess")}
globalThis.__assignmentScopeHooks = {
  canAssignToUserByManagementLine,
  canSeeUserByManagementLine,
  canSeeManagedWorkForUser,
  canSeeAssignmentByManagementLine,
  filterAssignmentsByManagementLine,
  canClaimItemByManagementLine,
  canTakeOverItemByManagementLine,
  canMutateItemByManagementLine,
  hasAssignmentAccess,
  hasAssignmentSubmissionAccess,
  hasItemBriefAccess,
};
`;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "assignment-scope-hooks.js" });
  return context.__assignmentScopeHooks;
}

test("assignment HTML removes readiness-only controls and keeps execution-only controls", () => {
  const forbiddenSnippets = [
    'id="btn-assignment-create-from-readiness"',
    'id="btn-evaluate-governance"',
    'id="btn-evaluate-handoff"',
    'id="assignment-debug-overrides"',
    "force_override handoff",
    "ready_for_handoff",
  ];
  for (const snippet of forbiddenSnippets) {
    assert.equal(indexHtml.includes(snippet), false, `forbidden HTML snippet should be removed: ${snippet}`);
  }

  const requiredSnippets = [
    'id="assignment-manual-create-panel"',
    'id="assignment-create-assignee-id"',
    'id="assignment-create-due-at"',
    'id="assignment-create-note"',
    'id="btn-assignment-create"',
    'id="assignment-review-note"',
    'id="btn-assignment-request-revision"',
    'id="btn-assignment-accept-submission"',
    'id="assignment-next-step-content"',
    'id="assignment-state-workspace"',
    'id="assignment-submission-workspace"',
    'id="assignment-review-workspace"',
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `required HTML snippet should exist: ${snippet}`);
  }
});

test("assignment app logic drops readiness create flow and uses manual item route", () => {
  const forbiddenSnippets = [
    "const ASSIGNMENT_EVALUATE_ENDPOINTS = Object.freeze({",
    "function evaluateAssignmentRoute(",
    "function canCreateAssignmentFromReadiness()",
    "function postCreateAssignmentFromReadiness(",
    "function reloadAssignmentsAfterCreate(",
    "function createAssignmentFromReadiness()",
    "function prefillCreateAssignmentFormFromItemId(",
    'evaluateAssignmentRoute("governance")',
    'evaluateAssignmentRoute("handoff")',
    'label: "governance-summary"',
    'label: "handoff-governance"',
    "/assignments/from-readiness",
    "function formatAssignmentBriefList(",
    "function formatAssignmentBriefReferences(",
    "function formatAssignmentBriefMediaHints(",
    "function formatAssignmentBriefSource(",
    "งานมอบหมาย/พร้อมส่งต่อ",
  ];
  for (const snippet of forbiddenSnippets) {
    assert.equal(appJs.includes(snippet), false, `forbidden app.js snippet should be removed: ${snippet}`);
  }

  const requiredSnippets = [
    "function createAssignmentForContextItem()",
    "function isAssignmentContextReady(status)",
    "function loadAssignmentContextFieldPackStatus(itemId)",
    "function evaluateAssignmentSubmissionDecision()",
    "function getAssignmentWorkspaceLayout(assignment)",
    "function syncAssignmentWorkflowLayout(assignment)",
    'api(`/api/items/${itemId}/assignments`',
    'api(`/api/items/${targetItemId}/field-pack/current`)',
    'createBtn.disabled = isWorkOnlyRole || !canCreateAssignment || !contextItemId || !isContextReady;',
    'if (!isAssignmentContextReady(state.assignments.contextFieldPackStatus)) {',
    'throw new Error(',
    'api(`/api/assignments/${assignmentId}/submission-decision/evaluate`',
    'qs("btn-assignment-create")?.addEventListener("click"',
    'id="assignment-submission-verified-fields"',
    'id="assignment-context-brief"',
    "function renderAssignmentContextBrief(",
    'node.innerHTML = "เลือกงานในกระบวนการนี้เพื่อดูคำสั่งงานของงานนี้";',
    'nextStepNode.textContent = "เลือกงานในกระบวนการนี้เพื่อดูขั้นถัดไปของงานนี้";',
  ];
  for (const snippet of requiredSnippets) {
    const haystack = snippet.startsWith('id="') ? indexHtml : appJs;
    assert.equal(haystack.includes(snippet), true, `required create-flow snippet should exist: ${snippet}`);
  }
});

test("manual assignment create flow is gated by step 4 prep-ready status in frontend and backend", () => {
  const requiredFrontendSnippets = [
    'await loadAssignmentContextFieldPackStatus(targetItemId);',
    'if (!isAssignmentContextReady(state.assignments.contextFieldPackStatus)) {',
    'throw new Error(',
  ];
  for (const snippet of requiredFrontendSnippets) {
    assert.equal(appJs.includes(snippet), true, `manual assignment create should gate prep-ready status in frontend: ${snippet}`);
  }

  const requiredBackendSnippets = [
    "const currentFieldPack = repo.getCurrentFieldPackByItem(id);",
    "if (!currentFieldPack || !Number(currentFieldPack?.id || 0)) {",
    'const fieldPackStatus = String(currentFieldPack?.status || "").trim().toLowerCase();',
    'if (fieldPackStatus !== "ready_for_field") {',
    `res.status(409).json({ error: 'item is not ready_for_assignment; brief is missing (complete step "จัด brief" first)' });`,
    `res.status(409).json({ error: 'item is not ready_for_assignment; complete step "พร้อมส่งเข้า handoff" (stored field pack status must be "ready_for_field")' });`,
  ];
  for (const snippet of requiredBackendSnippets) {
    assert.equal(indexServer.includes(snippet), true, `manual assignment create should gate prep-ready status in backend: ${snippet}`);
  }
});

test("assignment state patch permission keeps editor out of assignment workflow", () => {
  const canPatchMatch = appJs.match(/function canPatchAssignmentState\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(canPatchMatch, "canPatchAssignmentState should exist");
  const canPatchBody = canPatchMatch[1];

  assert.equal(canPatchBody.includes('role === "editor"'), false, "frontend state patch permission should not include editor");
  assert.equal(
    canPatchBody.includes("canManageFreelanceAssignments"),
    false,
    "frontend state patch permission should not depend on broader freelance management helper"
  );
  assert.equal(
    indexServer.includes('app.patch("/api/assignments/:id/state", requireRole("admin", "user")'),
    true,
    "backend assignment state patch route should keep editor out"
  );
});

test("user role can perform item-editor clean workflow actions", () => {
  const requiredItemEditorSnippets = [
    'function canClaimCurrentItem() {',
    'function canTakeOverCurrentItem() {',
    'function renderItemClaimBanner() {',
    'if (role !== "owner" && role !== "admin" && role !== "user") return false;',
    'return Number(state.item?.claimed_by_user_id || 0) > 0 && Number(state.item?.claimed_by_user_id || 0) === Number(state.user?.id || 0);',
    'const claimantRole = String(state.item?.claimed_by_user?.role || "").trim().toLowerCase();',
    'setPreparationEditingDisabled(!editGuard.allowed);',
    'await api(`/api/items/${state.itemId}/approved-context`, {',
    'await api(`/api/items/${state.itemId}/assets/${id}/selected`, {',
    'await api(`/api/items/${state.itemId}/assets/${id}/role`, {',
    'const aiResult = await api("/api/run/ai-draft", {',
    'await api(`/api/items/${state.itemId}/claim`, {',
    'await api(`/api/items/${state.itemId}/release`, {',
    'await api(`/api/items/${state.itemId}/takeover`, {',
  ];
  for (const snippet of requiredItemEditorSnippets) {
    assert.equal(itemEditorJs.includes(snippet), true, `item editor should allow user clean-workflow snippet: ${snippet}`);
  }

  const requiredServerSnippets = [
    'app.put("/api/items/:id", requireRole("admin", "user"), (req, res) => {',
    'app.put("/api/items/:id/editor-work", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/evidence-blocks", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/approved-context", requireRole("admin", "user"), (req, res) => {',
    'app.patch("/api/items/:id/approved-context/:contextId", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/field-packs", requireRole("admin", "user"), (req, res) => {',
    'app.put("/api/field-packs/:fieldPackId", requireRole("admin", "user"), (req, res) => {',
    'app.patch("/api/items/:id/assets/:assetId/selected", requireRole("admin", "user"), (req, res) => {',
    'app.patch("/api/items/:id/assets/:assetId/role", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/run/ai-draft", requireRole("admin", "user"), workflowRateLimit, async (req, res) => {',
    'app.post("/api/assets/upload", requireRole("admin", "user"), uploadRateLimit, upload.array("file", 20), async (req, res) => {',
    'app.post("/api/assets/register", requireRole("admin", "user"), uploadRateLimit, (req, res) => {',
    "function ensurePrepItemEditAccess(req, res, item) {",
    "if (!canClaimPrepItemRole(role)) {",
    'error: "ต้องรับงานนี้ก่อนจึงจะแก้รายการได้",',
    'app.post("/api/items/:id/claim", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/release", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/takeover", requireRole("admin"), (req, res) => {',
    'error: "confirm=true is required for takeover"',
    'error: "รายการนี้ยังไม่มีผู้รับงาน ให้ใช้การรับงานแทน takeover"',
    "function canTakeOverPrepClaim(actorRole = \"\", claimantRole = \"\") {",
    'error: claimantRole === "owner"',
    '"admin ไม่สามารถ takeover งานที่ owner ถืออยู่"',
    'res.status(400).json({ error: "content_item_id is required" });',
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `backend should allow user item-editor action snippet: ${snippet}`);
  }
});

test("process-1 UI exposes claim controls in item pages and raw queue", () => {
  const requiredHtmlSnippets = [
    'id="item-claim-banner"',
    'id="btn-item-claim"',
    'id="btn-item-release"',
    'id="btn-item-takeover"',
  ];
  for (const snippet of requiredHtmlSnippets) {
    assert.equal(cleanItemHtml.includes(snippet), true, `clean-item should render claim control snippet: ${snippet}`);
    assert.equal(itemEditorHtml.includes(snippet), true, `item-editor should render claim control snippet: ${snippet}`);
  }

  const requiredAppSnippets = [
    "function canClaimPreparationItem(item) {",
    "function canReleasePreparationItem(item) {",
    "function canTakeOverPreparationItem(item) {",
    'const claimantRole = String(item?.claimed_by_user?.role || "").trim().toLowerCase();',
    "<th>ผู้รับงาน</th>",
    'data-action="claim-item"',
    'data-action="release-item"',
    'data-action="takeover-item"',
    "await api(`/api/items/${id}/claim`, {",
    "await api(`/api/items/${id}/release`, {",
    "await api(`/api/items/${id}/takeover`, {",
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `raw queue should include claim UI snippet: ${snippet}`);
  }
});

test("claim banner and theme control stay wired to shared theme tokens", () => {
  const requiredStyleSnippets = [
    ".claim-banner {",
    "border: 1px solid var(--line);",
    "background: var(--theme-surface-soft);",
    "color: var(--text);",
    ".theme-mode-control {",
    "background: color-mix(in srgb, var(--card) 92%, transparent);",
  ];
  for (const snippet of requiredStyleSnippets) {
    assert.equal(stylesCss.includes(snippet), true, `theme-aware style should include snippet: ${snippet}`);
  }

  const requiredThemeSnippets = [
    'window.dispatchEvent(new CustomEvent("ubon-theme-change", {',
    'window.addEventListener("ubon-theme-change", syncSelectFromTheme);',
    "function syncSelectFromTheme() {",
    'document.addEventListener("DOMContentLoaded", syncSelectFromTheme, { once: true });',
    'window.addEventListener("pageshow", syncSelectFromTheme);',
    'select.dataset.themeBound = "1";',
  ];
  for (const snippet of requiredThemeSnippets) {
    assert.equal(themeBootstrapJs.includes(snippet) || themeControlJs.includes(snippet), true, `theme scripts should include snippet: ${snippet}`);
  }
});

test("item claim repository support exists for process-1 locking", () => {
  const requiredRepositorySnippets = [
    "function ensureItemClaimSupport(db) {",
    'db.exec("ALTER TABLE content_items ADD COLUMN claimed_by_user_id INTEGER;");',
    'db.exec("ALTER TABLE content_items ADD COLUMN claimed_at TEXT;");',
    'db.exec("ALTER TABLE content_items ADD COLUMN claim_note TEXT;");',
    "const claimItemStmt = db.prepare(`",
    "const takeOverItemClaimStmt = db.prepare(`",
    "const releaseItemClaimStmt = db.prepare(`",
    "const releaseItemClaimByAdminStmt = db.prepare(`",
    "function claimItem(itemId, claimedByUserId, options = {}) {",
    "function releaseItemClaim(itemId, claimedByUserId, options = {}) {",
    "function takeOverItemClaim(itemId, claimedByUserId, options = {}) {",
    "claimItem,",
    "releaseItemClaim,",
    "takeOverItemClaim,",
  ];
  for (const snippet of requiredRepositorySnippets) {
    assert.equal(repositoryJs.includes(snippet), true, `repository should include item claim support snippet: ${snippet}`);
  }
});

test("legacy from-readiness route is locked behind owner-only emergency policy", () => {
  const requiredSnippets = [
    'app.post("/api/items/:id/assignments/from-readiness", requireRole("owner")',
    "legacy from-readiness route requires force_override=true and force_reason",
    'res.status(400).json({ error: "assignee_user_id is required" });',
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(indexServer.includes(snippet), true, `legacy route should be narrowed by backend policy: ${snippet}`);
  }

  const forbiddenSnippets = [
    'app.post("/api/items/:id/assignments/from-readiness", requireRole("admin", "editor", "user")',
  ];
  for (const snippet of forbiddenSnippets) {
    assert.equal(indexServer.includes(snippet), false, `legacy route should no longer expose broad assignment roles: ${snippet}`);
  }
});

test("orphaned legacy handoff preview and handoff utility routes stay removed from the main app", () => {
  const forbiddenSnippets = [
    'app.get("/api/items/:id/assignment-handoff-preview"',
    'app.get("/api/assignments/:id/handoff-utility"',
    'app.post("/api/assignments/:id/handoff-utility/evaluate"',
  ];
  for (const snippet of forbiddenSnippets) {
    assert.equal(indexServer.includes(snippet), false, `orphaned legacy route should stay removed: ${snippet}`);
  }
});

test("assignment brief card no longer renders preparation checklists from legacy assignment context data", () => {
  const forbiddenSnippets = [
    "จุดที่ยังต้องเช็ก",
    "แหล่งอ้างอิงสำหรับเขียน",
    "ภาพอ้างอิง",
    "หมายเหตุสำหรับส่งต่อ",
    "หมายเหตุภาคสนาม",
    "ช็อตที่ควรถ่าย",
    "ประเด็นพูดหน้ากล้อง",
    "แนวทางแคปชัน",
    "สิ่งที่ต้องทำต่อ",
  ];
  for (const snippet of forbiddenSnippets) {
    assert.equal(appJs.includes(snippet), false, `assignment brief card should not render legacy preparation checklist snippet: ${snippet}`);
  }

  const requiredSnippets = [
    "function renderAssignmentContextBrief(",
    'id="assignment-context-brief"',
    "เลือกงานมอบหมายเพื่อดูข้อมูลตั้งต้นของงานนี้",
  ];
  for (const snippet of requiredSnippets) {
    const haystack = snippet.startsWith('id="') ? indexHtml : `${indexHtml}\n${appJs}`;
    assert.equal(haystack.includes(snippet), true, `assignment brief card should keep execution context snippet: ${snippet}`);
  }
});

test("assignments API data contract includes assignee display fields for linked summaries", () => {
  const requiredRepositorySnippets = [
    "COALESCE(u.display_name, a.assignee_name) AS assignee_display_name",
    "COALESCE(u.email, a.assignee_contact) AS assignee_email",
    "assigner.display_name AS assigned_by_display_name",
    "assigner.email AS assigned_by_email",
    "LEFT JOIN users u ON u.id = a.assignee_user_id",
    "LEFT JOIN users assigner ON assigner.id = a.assigned_by_user_id",
    "assignee_name TEXT",
    "assignee_contact TEXT",
  ];
  const repositoryJs = fs.readFileSync(path.join(collectorRoot, "db", "repository.mjs"), "utf8");
  for (const snippet of requiredRepositorySnippets) {
    assert.equal(repositoryJs.includes(snippet), true, `assignment repository should include assignee display field snippet: ${snippet}`);
  }
});

test("assignment create flow supports external assignees and due presets", () => {
  const requiredServerSnippets = [
    'const externalAssigneeName = String(req.body?.assignee_name || "").trim();',
    'const externalAssigneeContact = String(req.body?.assignee_contact || "").trim();',
    "const externalAssigneeProfile = normalizeExternalAssigneeProfilePayload(",
    "req.body?.external_assignee_profile_json,",
    'const assignedByMe = String(req.query.assigned_by_me || "").trim() === "1";',
    "const assignments = repo.listExternalAssignmentsByAssigner(req.authUser?.id, limit);",
    'if (!assigneeId && (!externalAssigneeProfile?.name || (!externalAssigneeProfile.phone && !externalAssigneeProfile.email && !externalAssigneeProfile.line_id))) {',
    "external assignee requires name and at least one contact field (phone/email/line_id)",
    'assignee_name: assignment?.assignee_name || null,',
    'assignee_contact: assignment?.assignee_contact || null,',
    'external_assignee_profile_json: assignment?.external_assignee_profile_json || null,',
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `assignment create server snippet should exist: ${snippet}`);
  }

  const repositoryJs = fs.readFileSync(path.join(collectorRoot, "db", "repository.mjs"), "utf8");
  const requiredRepositorySnippets = [
    "const listExternalAssignmentsByAssignerStmt = db.prepare(`",
    "WHERE a.assigned_by_user_id=? AND a.assignee_user_id IS NULL",
    "function listExternalAssignmentsByAssigner(assignerUserId, limit = 50) {",
    "listExternalAssignmentsByAssigner,",
  ];
  for (const snippet of requiredRepositorySnippets) {
    assert.equal(repositoryJs.includes(snippet), true, `assignment repository external-assignee listing snippet should exist: ${snippet}`);
  }

  const requiredAppSnippets = [
    'return `/api/assignments/mine?assignee_user_id=${selfId}&limit=${limit}`;',
    'function formatAssignmentDueAtLabel(value) {',
    'timeZone: "Asia/Bangkok",',
    'return `${dateLabel} สิ้นวัน`;',
    'formatAssignmentDueAtLabel(row.due_at)',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment create app snippet should exist: ${snippet}`);
  }
});

test("user profile and external assignee contracts are wired end-to-end with minimal schema changes", () => {
  const schemaSql = fs.readFileSync(path.join(collectorRoot, "database", "schema.sql"), "utf8");
  const repositoryJs = fs.readFileSync(path.join(collectorRoot, "db", "repository.mjs"), "utf8");

  const requiredSchemaSnippets = [
    "profile_json TEXT",
    "external_assignee_profile_json TEXT",
  ];
  for (const snippet of requiredSchemaSnippets) {
    assert.equal(schemaSql.includes(snippet), true, `schema should include new contract field: ${snippet}`);
  }

  const requiredRepositorySnippets = [
    "function ensureUsersProfileSupport(db) {",
    "db.exec(\"ALTER TABLE users ADD COLUMN profile_json TEXT;\");",
    "const externalAssigneeProfile = parseJson(row.external_assignee_profile_json, null);",
    "external_assignee_profile_json: externalAssigneeProfile,",
    "assignee_email: externalAssigneeEmail || internalAssigneeEmail || null,",
    "external_assignee_profile_json, assigned_by_user_id, state,",
    "external_assignee_profile_json: assigneeId ? null : externalAssigneeProfile,",
    "if (fallback.startsWith(\"@\")) {",
    "profile.line_id = fallback;",
  ];
  for (const snippet of requiredRepositorySnippets) {
    const haystack = snippet.includes("assigneeId ? null") ? indexServer : repositoryJs;
    assert.equal(haystack.includes(snippet), true, `repository/server should include new contract snippet: ${snippet}`);
  }

  const requiredServerSnippets = [
    'app.patch("/api/users/:id/profile", requireRole("owner", "admin", "user"), (req, res) => {',
    'app.post("/api/users/avatar/upload", requireRole("owner", "admin", "user"), uploadRateLimit, upload.single("file"), async (req, res) => {',
    "profile_json: draftProfile,",
    "avatar_url: avatarUrlByAssetId instanceof Map",
    "req.body?.external_assignee_profile_json,",
    "const profileSource = rawProfile || req.body || {};",
    'phone: hasPhone ? (incomingProfile.phone || "") : (existingProfile.phone || ""),',
    'email_alt: hasEmailAlt ? (incomingProfile.email_alt || "") : (existingProfile.email_alt || ""),',
    'line_id: hasLineId ? (incomingProfile.line_id || "") : (existingProfile.line_id || ""),',
    'pic_asset_id: hasPicAssetId ? (incomingProfile.pic_asset_id || null) : (existingProfile.pic_asset_id || null),',
    "SELECT id FROM assets WHERE id=? AND mime_type LIKE 'image/%' LIMIT 1",
    'res.status(400).json({ error: "pic_asset_id not found or is not an image asset" });',
    "if (fallback.startsWith(\"@\")) profile.line_id = fallback;",
    "avatar_url: avatarUrlByAssetId instanceof Map",
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `server should include profile/external-assignee contract snippet: ${snippet}`);
  }

  const requiredIndexSnippets = [
    'id="user-phone"',
    'id="user-email-alt"',
    'id="user-line-id"',
    'id="user-pic-file"',
    'id="assignment-create-assignee-phone"',
    'id="assignment-create-assignee-email"',
    'id="assignment-create-assignee-line-id"',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `index should expose contract input snippet: ${snippet}`);
  }

  const requiredAppSnippets = [
    "async function openUserProfileCropModal(file) {",
    "async function buildUserProfileCropResult() {",
    "api(\"/api/users/avatar/upload\", {",
    "payload.profile_json = {",
    "payload.external_assignee_profile_json = {",
    "function renderAssignmentAssigneeSelectionSummary(secondaryText = \"\") {",
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `app should include contract snippet: ${snippet}`);
  }
});

test("users avatar enrichment batches asset lookup and maps public URLs in one pass", () => {
  let prepareCount = 0;
  const buildUserAvatarUrlMap = new Function(
    "db",
    "normalizeUserProfilePayload",
    "parseAssetPathForUrl",
    `${extractNamedFunctionSource(indexServer, "buildUserAvatarUrlMap")}; return buildUserAvatarUrlMap;`
  )(
    {
      prepare(sql) {
        prepareCount += 1;
        return {
          sql,
          all(...ids) {
            return ids.map((id) => ({ id, storage_path: `avatars/${id}.jpg` }));
          },
        };
      },
    },
    (value) => {
      if (typeof value === "string") return JSON.parse(value);
      return value || {};
    },
    (storagePath) => `/media/${storagePath}`
  );

  const avatarMap = buildUserAvatarUrlMap([
    { profile_json: JSON.stringify({ pic_asset_id: 7 }) },
    { profile_json: { pic_asset_id: 9 } },
    { profile_json: { pic_asset_id: 7 } },
    { profile_json: {} },
  ]);

  assert.equal(avatarMap.get(7), "/media/avatars/7.jpg");
  assert.equal(avatarMap.get(9), "/media/avatars/9.jpg");
  assert.equal(avatarMap.size, 2);
  assert.equal(prepareCount, 1);
});

test("work-lane article payload prefill keeps only current field-pack prompts and preserves previous answers", () => {
  const normalized = normalizeAssignmentSubmissionArticlePayloadForTest(
    {
      verified_answers: [
        { prompt: "ยืนยันเวลาเปิด", answer: "08:00-17:00" },
        { prompt: "หัวข้อเก่า", answer: "ไม่ควรติดมาด้วย" },
      ],
      question_answers: [
        { prompt: "ถามค่าบริการ", answer: "50 บาท" },
      ],
      additional_text: "มีข้อมูลเพิ่ม",
    },
    {
      must_verify_facts_json: ["ยืนยันเวลาเปิด", "ยืนยันพิกัด"],
      must_ask_questions_json: ["ถามค่าบริการ", "ถามวันหยุด"],
    }
  );

  assert.deepEqual(normalized.verified_answers, [
    { prompt: "ยืนยันเวลาเปิด", answer: "08:00-17:00" },
    { prompt: "ยืนยันพิกัด", answer: "" },
  ]);
  assert.deepEqual(normalized.question_answers, [
    { prompt: "ถามค่าบริการ", answer: "50 บาท" },
    { prompt: "ถามวันหยุด", answer: "" },
  ]);
  assert.equal(normalized.additional_text, "มีข้อมูลเพิ่ม");
});

test("assignment submission access is limited to assignee or external assigner only", () => {
  const { hasAssignmentSubmissionAccess } = loadAssignmentManagementScopeHooks([
    { id: 3, role: "user", managed_by_user_id: 0 },
    { id: 12, role: "freelance", managed_by_user_id: 3 },
  ]);
  assert.equal(
    hasAssignmentSubmissionAccess(
      { authUser: { id: 12, role: "freelance" } },
      { assignee_user_id: 12, assigned_by_user_id: 3 }
    ),
    true
  );
  assert.equal(
    hasAssignmentSubmissionAccess(
      { authUser: { id: 3, role: "user" } },
      { assignee_user_id: 12, assigned_by_user_id: 3 }
    ),
    true
  );
  assert.equal(
    hasAssignmentSubmissionAccess(
      { authUser: { id: 3, role: "user" } },
      { assignee_user_id: null, assigned_by_user_id: 3 }
    ),
    true
  );
});

test("assignment management-line helpers keep admin scoped and owner global", () => {
  const {
    canAssignToUserByManagementLine,
    canSeeManagedWorkForUser,
    canSeeAssignmentByManagementLine,
    hasAssignmentAccess,
    hasAssignmentSubmissionAccess,
  } = loadAssignmentManagementScopeHooks([
    { id: 1, role: "owner", managed_by_user_id: 0 },
    { id: 10, role: "admin", managed_by_user_id: 1 },
    { id: 11, role: "user", managed_by_user_id: 10 },
    { id: 12, role: "freelance", managed_by_user_id: 11 },
    { id: 20, role: "admin", managed_by_user_id: 1 },
    { id: 21, role: "user", managed_by_user_id: 20 },
    { id: 30, role: "editor", managed_by_user_id: 10 },
  ]);

  const adminReq = { authUser: { id: 10, role: "admin" } };
  const ownerReq = { authUser: { id: 1, role: "owner" } };
  const editorReq = { authUser: { id: 30, role: "editor" } };

  const subtreeAssignment = { assignment_kind: "field", assignee_user_id: 12, assigned_by_user_id: 11 };
  const outOfScopeAssignedByVisible = { assignment_kind: "field", assignee_user_id: 21, assigned_by_user_id: 11 };
  const ownerAssignment = { assignment_kind: "field", assignee_user_id: 1, assigned_by_user_id: 1 };
  const otherBranchAssignment = { assignment_kind: "field", assignee_user_id: 21, assigned_by_user_id: 20 };
  const externalByOwner = { assignment_kind: "field", assignee_user_id: null, assigned_by_user_id: 1 };

  assert.equal(canAssignToUserByManagementLine(adminReq.authUser, 12), true);
  assert.equal(canAssignToUserByManagementLine(adminReq.authUser, 10), false);
  assert.equal(canAssignToUserByManagementLine(adminReq.authUser, 21), false);
  assert.equal(canAssignToUserByManagementLine(adminReq.authUser, 1), false);
  assert.equal(canSeeManagedWorkForUser(adminReq.authUser, 12), true);
  assert.equal(canSeeManagedWorkForUser(adminReq.authUser, 10), false);
  assert.equal(canSeeManagedWorkForUser(adminReq.authUser, 10, { allowSelf: true }), true);
  assert.equal(canSeeManagedWorkForUser(adminReq.authUser, 21), false);

  assert.equal(canSeeAssignmentByManagementLine(adminReq.authUser, subtreeAssignment), true);
  assert.equal(hasAssignmentAccess(adminReq, subtreeAssignment, "admin"), true);
  assert.equal(hasAssignmentSubmissionAccess(adminReq, subtreeAssignment, "admin"), true);

  assert.equal(canSeeAssignmentByManagementLine(adminReq.authUser, outOfScopeAssignedByVisible), false);
  assert.equal(hasAssignmentAccess(adminReq, outOfScopeAssignedByVisible, "admin"), false);

  assert.equal(canSeeAssignmentByManagementLine(adminReq.authUser, ownerAssignment), false);
  assert.equal(hasAssignmentAccess(adminReq, ownerAssignment, "admin"), false);
  assert.equal(hasAssignmentSubmissionAccess(adminReq, ownerAssignment, "admin"), false);

  assert.equal(canSeeAssignmentByManagementLine(adminReq.authUser, otherBranchAssignment), false);
  assert.equal(hasAssignmentAccess(adminReq, otherBranchAssignment, "admin"), false);
  assert.equal(hasAssignmentSubmissionAccess(adminReq, otherBranchAssignment, "admin"), false);

  assert.equal(canSeeAssignmentByManagementLine(adminReq.authUser, externalByOwner), false);
  assert.equal(hasAssignmentAccess(adminReq, externalByOwner, "admin"), false);

  assert.equal(hasAssignmentAccess(ownerReq, ownerAssignment, "owner"), true);
  assert.equal(hasAssignmentSubmissionAccess(ownerReq, ownerAssignment, "owner"), true);

  assert.equal(hasAssignmentAccess(editorReq, { assignment_kind: "editorial", assignee_user_id: 30, assigned_by_user_id: 10 }, "editor"), true);
  assert.equal(hasAssignmentAccess(editorReq, { assignment_kind: "field", assignee_user_id: 30, assigned_by_user_id: 10 }, "editor"), false);
});

test("item brief access follows assignment and claim scope instead of global admin/user visibility", () => {
  const {
    hasItemBriefAccess,
  } = loadAssignmentManagementScopeHooks(
    [
      { id: 1, role: "owner", managed_by_user_id: 0 },
      { id: 10, role: "admin", managed_by_user_id: 1 },
      { id: 11, role: "user", managed_by_user_id: 10 },
      { id: 12, role: "freelance", managed_by_user_id: 11 },
      { id: 20, role: "admin", managed_by_user_id: 1 },
      { id: 21, role: "user", managed_by_user_id: 20 },
    ],
    {
      items: [
        { id: 100, claimed_by_user_id: 11 },
        { id: 101, claimed_by_user_id: 1 },
        { id: 102, claimed_by_user_id: 10 },
        { id: 103, claimed_by_user_id: 0 },
      ],
      assignments: [
        { id: 500, content_item_id: 100, assignment_kind: "field", assignee_user_id: 12, assigned_by_user_id: 11, state: "assigned" },
        { id: 501, content_item_id: 101, assignment_kind: "field", assignee_user_id: 1, assigned_by_user_id: 1, state: "assigned" },
        { id: 502, content_item_id: 103, assignment_kind: "field", assignee_user_id: 21, assigned_by_user_id: 20, state: "assigned" },
      ],
    }
  );

  assert.equal(hasItemBriefAccess({ authUser: { id: 10, role: "admin" } }, 100, "admin"), true);
  assert.equal(hasItemBriefAccess({ authUser: { id: 10, role: "admin" } }, 101, "admin"), false);
  assert.equal(hasItemBriefAccess({ authUser: { id: 10, role: "admin" } }, 103, "admin"), false);
  assert.equal(hasItemBriefAccess({ authUser: { id: 10, role: "admin" } }, 102, "admin"), false);
  assert.equal(hasItemBriefAccess({ authUser: { id: 10, role: "admin" } }, 999, "admin"), false);

  assert.equal(hasItemBriefAccess({ authUser: { id: 11, role: "user" } }, 102, "user"), false);
  assert.equal(hasItemBriefAccess({ authUser: { id: 11, role: "user" } }, 100, "user"), true);

  assert.equal(hasItemBriefAccess({ authUser: { id: 1, role: "owner" } }, 101, "owner"), true);
});

test("claim and takeover helpers do not let admin or user manufacture scope", () => {
  const {
    canClaimItemByManagementLine,
    canTakeOverItemByManagementLine,
    canMutateItemByManagementLine,
  } = loadAssignmentManagementScopeHooks(
    [
      { id: 1, role: "owner", managed_by_user_id: 0 },
      { id: 10, role: "admin", managed_by_user_id: 1 },
      { id: 11, role: "user", managed_by_user_id: 10 },
      { id: 12, role: "freelance", managed_by_user_id: 11 },
      { id: 20, role: "admin", managed_by_user_id: 1 },
      { id: 21, role: "user", managed_by_user_id: 20 },
    ],
    {
      items: [
        { id: 200, claimed_by_user_id: 11 },
        { id: 201, claimed_by_user_id: 1 },
        { id: 202, claimed_by_user_id: 21 },
        { id: 203, claimed_by_user_id: 0 },
        { id: 204, claimed_by_user_id: 0 },
      ],
      assignments: [
        { id: 600, content_item_id: 203, assignment_kind: "field", assignee_user_id: 12, assigned_by_user_id: 11, state: "assigned" },
        { id: 601, content_item_id: 204, assignment_kind: "field", assignee_user_id: 21, assigned_by_user_id: 20, state: "assigned" },
      ],
    }
  );

  assert.equal(canClaimItemByManagementLine({ id: 10, role: "admin" }, { id: 203, claimed_by_user_id: 0 }), true);
  assert.equal(canClaimItemByManagementLine({ id: 10, role: "admin" }, { id: 204, claimed_by_user_id: 0 }), false);
  assert.equal(canClaimItemByManagementLine({ id: 10, role: "admin" }, { id: 201, claimed_by_user_id: 1 }), false);
  assert.equal(canClaimItemByManagementLine({ id: 11, role: "user" }, { id: 203, claimed_by_user_id: 0 }), true);
  assert.equal(canClaimItemByManagementLine({ id: 11, role: "user" }, { id: 204, claimed_by_user_id: 0 }), false);
  assert.equal(canClaimItemByManagementLine({ id: 1, role: "owner" }, { id: 204, claimed_by_user_id: 0 }), true);

  assert.equal(canTakeOverItemByManagementLine({ id: 10, role: "admin" }, { id: 200, claimed_by_user_id: 11 }), true);
  assert.equal(canTakeOverItemByManagementLine({ id: 10, role: "admin" }, { id: 201, claimed_by_user_id: 1 }), false);
  assert.equal(canTakeOverItemByManagementLine({ id: 10, role: "admin" }, { id: 202, claimed_by_user_id: 21 }), false);
  assert.equal(canTakeOverItemByManagementLine({ id: 1, role: "owner" }, { id: 201, claimed_by_user_id: 1 }), true);

  assert.equal(canMutateItemByManagementLine({ id: 10, role: "admin" }, { id: 203, claimed_by_user_id: 0 }), true);
  assert.equal(canMutateItemByManagementLine({ id: 10, role: "admin" }, { id: 204, claimed_by_user_id: 0 }), false);
  assert.equal(canMutateItemByManagementLine({ id: 10, role: "admin" }, { id: 201, claimed_by_user_id: 1 }), false);
  assert.equal(canMutateItemByManagementLine({ id: 1, role: "owner" }, { id: 204, claimed_by_user_id: 0 }), true);
});

test("assignment routes use management-line scope helpers instead of global admin visibility", () => {
  const routeIndex = (snippet) => indexServer.indexOf(snippet);
  const routeContainsAfter = (routeSnippet, targetSnippet) => {
    const start = routeIndex(routeSnippet);
    if (start < 0) return false;
    return indexServer.indexOf(targetSnippet, start) > start;
  };
  const routeGuardBefore = (routeSnippet, guardSnippet, actionSnippet) => {
    const start = routeIndex(routeSnippet);
    if (start < 0) return false;
    const guard = indexServer.indexOf(guardSnippet, start);
    const action = indexServer.indexOf(actionSnippet, start);
    return guard > start && action > guard;
  };
  const requiredSnippets = [
    "function canAssignToUserByManagementLine(authUser, targetUserId) {",
    "function canSeeUserByManagementLine(authUser, targetUserId) {",
    "function canSeeManagedWorkForUser(authUser, targetUserId, options) {",
    "function canSeeAssignmentByManagementLine(authUser, assignment) {",
    "function hasItemBriefAccess(req, contentItemId, role = actorPolicyRole(req)) {",
    "function filterAssignmentsByManagementLine(authUser, assignments = []) {",
    "function canClaimItemByManagementLine(authUser, item) {",
    "function canTakeOverItemByManagementLine(authUser, item) {",
    "function canMutateItemByManagementLine(authUser, item, options) {",
    "function ensureItemMutationAccess(req, res, item, options = {}) {",
    "function ensureArticleProcessTransitionAccess(req, res, item, nextStatus) {",
    'if (role === "admin") return canSeeAssignmentByManagementLine(req.authUser, assignment);',
    'if (assigneeUserId > 0) return canSeeManagedWorkForUser(authUser, assigneeUserId);',
    'const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;',
    'if (claimedByUserId > 0 && canSeeManagedWorkForUser(req.authUser, claimedByUserId)) {',
    'if (!canClaimItemByManagementLine(req.authUser, decoratedCurrent)) {',
    'if (!canTakeOverPrepClaim(actorRole, claimantRole) || !canTakeOverItemByManagementLine(req.authUser, decoratedCurrent)) {',
    'if ((role === "admin" || role === "user") && canMutateItemByManagementLine(req.authUser, item)) {',
    'if (!ensureItemMutationAccess(req, res, item)) {',
    'if (!ensureItemBriefReadAccess(req, res, item)) {',
    'app.get("/api/items/:id", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/readiness/latest", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/approved-context", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/brief/latest", requireRole("owner", "admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/field-pack/current", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {',
    'app.get("/api/items/:id/draft-input-preview", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/media-candidates", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/image-workflow", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/export-readiness", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/workflow-model", requireRole("owner", "admin", "editor", "user"), (req, res) => {',
    'app.get("/api/items/:id/article-process", requireRole("owner", "admin", "editor", "user"), (req, res) => {',
    'app.post("/api/items/:id/article-process/transition", requireRole("owner", "admin", "editor", "user"), async (req, res) => {',
    'app.post("/api/items/:id/article-process/submit-review", requireRole("owner", "admin", "editor", "user"), (req, res) => {',
    'app.get("/api/items/:id/transitions", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/audit-logs", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/intelligence-model/latest", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/execution-controls/latest", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/execution-channels", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/execution-readiness", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/execution-readiness/:channel", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/governance-summary", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/execution-channels/:channel/latest", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/search-enrichment", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/place-intelligence", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/social-signals", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/momentum", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/content-direction", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/evidence-blocks", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/items/:id/assignments", requireRole("owner", "admin", "user"), (req, res) => {',
    'app.put("/api/items/:id/workflow-model", requireRole("owner", "admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/assets/cleanup-eligibility", requireRole("admin", "owner"), (req, res) => {',
    'app.post("/api/items/:id/recheck-export-readiness", requireRole("admin", "owner"), (req, res) => {',
    'app.post("/api/items/:id/release-main", requireRole("admin", "owner"), workflowRateLimit, async (req, res) => {',
    'app.post("/api/items/:id/submit-admin-review", requireRole("admin", "owner"), workflowRateLimit, async (req, res) => {',
    'app.post("/api/items/:id/recover-problem-translations", requireRole("admin", "owner"), async (req, res) => {',
    'app.post("/api/items/:id/generate-translations", requireRole("admin", "owner"), async (req, res) => {',
    'app.post("/api/items/:id/translations/:lang/recheck", requireRole("admin", "owner"), async (req, res) => {',
    'app.post("/api/items/:id/translations/:lang/repair", requireRole("admin", "owner"), async (req, res) => {',
    'app.post("/api/items/:id/recompute-readiness-brief", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/intelligence-model", requireRole("admin"), (req, res) => {',
    'app.post("/api/items/:id/recompute-execution-controls", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/execution-readiness/evaluate", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/governance-summary/evaluate", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/execution-channels", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/execution-channels/:channel/validate-latest", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/execution-channels/:channel/generate", requireRole("admin", "user"), async (req, res) => {',
    'app.post("/api/items/:id/search-enrichment", requireRole("admin"), (req, res) => {',
    'app.post("/api/items/:id/recompute-intelligence", requireRole("admin"), (req, res) => {',
    'app.post("/api/items/:id/social-signals", requireRole("admin"), (req, res) => {',
    'app.post("/api/items/:id/momentum/recompute", requireRole("admin"), (req, res) => {',
    'app.post("/api/items/:id/recompute-content-direction", requireRole("admin"), (req, res) => {',
    'app.post("/api/items/:id/article-editorial-assignments", requireRole("owner", "admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/article-editorial-assignments/:assignmentId/request-revision", requireRole("owner", "admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/assignments", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/unpublish", requireRole("admin", "owner"), (req, res) => {',
    'app.post("/api/assets/upload", requireRole("owner", "admin", "editor", "user"), uploadRateLimit, upload.array("file", 20), async (req, res) => {',
    'app.put("/api/transport-map-routes/:id", requireRole("owner", "admin", "user"), (req, res) => {',
    'const assignments = buildManagedAssignmentsForActor(req.authUser?.id, authRole, limit);',
    'const assignments = filterAssignmentsByManagementLine(',
    'filterAssignmentsByManagementLine(\n        authUser,',
    'filterAssignmentsByManagementLine(\n      { id: actorUserId, role },',
    'assigner cannot assign work outside the management subtree',
    'assigner cannot assign article work outside the management subtree',
  ];
  for (const snippet of requiredSnippets) {
    assert.equal(indexServer.includes(snippet), true, `assignment scope helper snippet should exist: ${snippet}`);
  }

  const forbiddenSnippets = [
    'if (role === "owner" || role === "admin") return true;',
    'if (role === "owner" || role === "admin") return true',
    'if (authRole === "owner" || authRole === "admin") {',
    'if (role === "owner" || role === "admin" || role === "user") return true;',
    'if (role === "owner" || role === "admin" || role === "user") {',
    'if (role === "owner" || role === "admin" || role === "user") {\r\n    return true;\r\n  }',
    'if (role === "owner" || role === "admin" || role === "user") {\n    return true;\n  }',
    'if ((role === "editor" || role === "freelance") && !hasItemBriefAccess(req, id, role)) {',
    'canSeeManagedWorkForUser(req.authUser, claimedByUserId, { allowSelf: true })',
    'repo.claimItem(id, actorId, { claim_note: req.body?.claim_note })',
    'repo.takeOverItemClaim(id, actorId, { claim_note: req.body?.claim_note })',
    'const assignments = repo.listAssignments(limit);',
  ];
  assert.equal(
    indexServer.includes('if (authRole === "owner") {\r\n      const assignments = repo.listAssignments(limit);')
      || indexServer.includes('if (authRole === "owner") {\n      const assignments = repo.listAssignments(limit);'),
    true,
    "owner-only global assignments branch should remain"
  );
  assert.equal(
    indexServer.includes('if (authRole === "owner" || authRole === "admin") {\r\n      const assignments = repo.listAssignments(limit);')
      || indexServer.includes('if (authRole === "owner" || authRole === "admin") {\n      const assignments = repo.listAssignments(limit);'),
    false,
    "admin should no longer share owner global assignments branch"
  );
  for (const snippet of forbiddenSnippets.slice(0, 3)) {
    assert.equal(indexServer.includes(snippet), false, `legacy global visibility snippet should be removed: ${snippet}`);
  }
  assert.equal(
    indexServer.includes('if (!canClaimItemByManagementLine(req.authUser, decoratedCurrent)) {\r\n    res.status(403).json({ error: "forbidden" });')
      || indexServer.includes('if (!canClaimItemByManagementLine(req.authUser, decoratedCurrent)) {\n    res.status(403).json({ error: "forbidden" });'),
    true,
    "claim route should deny before mutation"
  );
  assert.equal(
    indexServer.indexOf('if (!canClaimItemByManagementLine(req.authUser, decoratedCurrent)) {')
      < indexServer.indexOf('repo.claimItem(id, actorId, { claim_note: req.body?.claim_note })'),
    true,
    "claim helper must run before repo.claimItem"
  );
  assert.equal(
    indexServer.indexOf('if (!canTakeOverPrepClaim(actorRole, claimantRole) || !canTakeOverItemByManagementLine(req.authUser, decoratedCurrent)) {')
      < indexServer.indexOf('repo.takeOverItemClaim(id, actorId, { claim_note: req.body?.claim_note })'),
    true,
    "takeover helper must run before repo.takeOverItemClaim"
  );
  assert.equal(
    indexServer.includes('app.post("/api/items/:id/claim", requireRole("owner", "admin", "user"), (req, res) => {'),
    true,
    "claim route must allow owner"
  );
  assert.equal(
    indexServer.includes('app.post("/api/items/:id/field-packs", requireRole("owner", "admin", "user"), (req, res) => {\r\n')
      || indexServer.includes('app.post("/api/items/:id/field-packs", requireRole("owner", "admin", "user"), (req, res) => {\n'),
    true,
    "field-pack create route should still be present"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const fieldPack = repo.createFieldPack({'),
    true,
    "field-pack create must guard subtree mutation before create"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const fieldPack = repo.updateFieldPack(fieldPackId, {'),
    true,
    "field-pack update must guard subtree mutation before update"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const agentEngine = createAgentGenerationEngine(aiConfig);'),
    true,
    "field-pack regenerate must guard subtree mutation before regenerate"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const status = repo.setContentAssetSelected(id, assetId, selected);'),
    true,
    "asset selected route must guard subtree mutation before update"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const status = repo.setContentAssetRole(id, assetId, role);'),
    true,
    "asset role route must guard subtree mutation before update"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureComposerMediaEditAccess(req, res, item)) {')
      < indexServer.indexOf('const requestedRole = String(req.body.role || "gallery");'),
    true,
    "asset upload route must stay behind subtree-aware media mutation guard"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/assets/register", requireRole("owner", "admin", "editor", "user"), uploadRateLimit, (req, res) => {',
      'if (!ensureComposerMediaEditAccess(req, res, item)) {',
      'const assetUid = crypto.randomUUID();'
    ),
    true,
    "asset register route must stay behind subtree-aware media mutation guard"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, current)) {')
      < indexServer.indexOf('const routePayload = normalizeTransportRoutePayload(req.body || null, current);'),
    true,
    "transport route update must guard subtree mutation before update"
  );
  assert.equal(
    indexServer.includes('if ((role === "admin" || role === "user") && canMutateItemByManagementLine(req.authUser, item)) {'),
    true,
    "composer edit helper must use subtree helper for admin/user instead of role-global allow"
  );
  assert.equal(
    indexServer.includes('if (role === "owner" || role === "admin" || role === "user") return true;'),
    false,
    "article-process read helper must not allow admin/user globally by role"
  );
  assert.equal(
    indexServer.includes('if (role === "admin" || role === "user") {\r\n    return hasItemBriefAccess(req, Number(item?.id || 0) || 0, role);\r\n  }')
      || indexServer.includes('if (role === "admin" || role === "user") {\n    return hasItemBriefAccess(req, Number(item?.id || 0) || 0, role);\n  }'),
    true,
    "article-process read helper must delegate admin/user access to subtree item-read scope"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const officialReference = repo.getOfficialReferenceByItem(id);'
    ),
    true,
    "item detail route must guard subtree read access before loading item context"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemBriefReadAccess(req, res, item)) {')
      < indexServer.indexOf('const preview = buildCleanStructuredContext(repo, id);'),
    true,
    "draft-input-preview must guard subtree read access before returning context"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemBriefReadAccess(req, res, item)) {')
      < indexServer.indexOf('const sourceRecord = db'),
    true,
    "media-candidates must guard subtree read access before returning item media context"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemBriefReadAccess(req, res, item)) {')
      < indexServer.indexOf('const status = buildImageWorkflowState(id);'),
    true,
    "image-workflow must guard subtree read access before returning workflow state"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemBriefReadAccess(req, res, item)) {')
      < indexServer.indexOf('const readiness = buildExportReadiness(id);'),
    true,
    "export-readiness must guard subtree read access before returning readiness"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/workflow-model", requireRole("owner", "admin", "editor", "user"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const model = repo.ensureWorkflowModel(id);'
    ),
    true,
    "workflow-model must guard subtree read access before returning workflow context"
  );
  assert.equal(
    routeContainsAfter(
      'app.get("/api/items/:id/article-process", requireRole("owner", "admin", "editor", "user"), (req, res) => {',
      'if (!ensureArticleProcessReadAccess(req, res, item)) {'
    ),
    true,
    "article-process read route must use article-process read guard"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/article-process/transition", requireRole("owner", "admin", "editor", "user"), async (req, res) => {',
      'if (!ensureArticleProcessTransitionAccess(req, res, item, nextStatus)) {',
      'const workflowModel = repo.ensureWorkflowModel(id);'
    ),
    true,
    "article-process transition route must guard subtree mutation before transition logic"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/article-process/submit-review", requireRole("owner", "admin", "editor", "user"), (req, res) => {',
      'if (!ensureArticleProcessTransitionAccess(req, res, item, "ready_for_review")) {',
      'const workflowModel = repo.ensureWorkflowModel(id);'
    ),
    true,
    "article-process submit-review must guard subtree mutation before submit logic"
  );
  assert.equal(
    routeGuardBefore(
      'app.put("/api/items/:id/workflow-model", requireRole("owner", "admin", "user"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const actorRole = actorPolicyRole(req);'
    ),
    true,
    "workflow-model update must guard subtree mutation before updating state"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/transitions", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'transitions = repo.listWorkflowTransitionsByItem(id, limit, {'
    ),
    true,
    "transitions route must guard subtree read access before listing workflow transitions"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/audit-logs", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const logs = repo.listAuditByTarget("content_item", String(id), limit, {'
    ),
    true,
    "audit-logs route must guard subtree read access before listing content item audit logs"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/intelligence-model/latest", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const model = repo.getLatestIntelligenceModelByItem(id);'
    ),
    true,
    "intelligence-model latest route must guard subtree read access before loading model"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/execution-controls/latest", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const readiness = repo.getLatestReadinessBriefByItem(id);'
    ),
    true,
    "execution-controls latest route must guard subtree read access before loading readiness/controls context"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/execution-channels", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const channels = repo.listExecutionChannelsByItem(id);'
    ),
    true,
    "execution-channels route must guard subtree read access before listing channels"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/execution-readiness", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const summary = repo.evaluateExecutionReadinessByItem(id);'
    ),
    true,
    "execution-readiness route must guard subtree read access before evaluating readiness"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/execution-readiness/:channel", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const readiness = repo.evaluateExecutionReadinessByItem(id, channel);'
    ),
    true,
    "execution-readiness by channel route must guard subtree read access before evaluating channel readiness"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/governance-summary", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const summary = repo.buildGovernanceSummaryByItem(id);'
    ),
    true,
    "governance-summary route must guard subtree read access before building summary"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/execution-channels/:channel/latest", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const latest = repo.getLatestExecutionChannelByItemAndChannel(id, channel);'
    ),
    true,
    "execution-channel latest route must guard subtree read access before loading latest channel state"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/search-enrichment", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const records = repo.listSearchEnrichmentByItem(id);'
    ),
    true,
    "search-enrichment route must guard subtree read access before loading enrichment records"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/place-intelligence", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const intelligence = repo.getPlaceIntelligenceByItem(id);'
    ),
    true,
    "place-intelligence route must guard subtree read access before loading intelligence"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/social-signals", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const signals = repo.listSocialSignalSourcesByItem(id);'
    ),
    true,
    "social-signals route must guard subtree read access before loading signals"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/momentum", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const snapshots = repo.listMomentumSnapshotsByItem(id, platform);'
    ),
    true,
    "momentum route must guard subtree read access before loading snapshots"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/content-direction", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const report = repo.getLatestContentDirectionByItem(id);'
    ),
    true,
    "content-direction route must guard subtree read access before loading report"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/evidence-blocks", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'let blocks = repo.listEvidenceBlocks(id);'
    ),
    true,
    "evidence-blocks route must guard subtree read access before loading evidence data"
  );
  assert.equal(
    routeGuardBefore(
      'app.get("/api/items/:id/assignments", requireRole("owner", "admin", "user"), (req, res) => {',
      'if (!ensureItemBriefReadAccess(req, res, item)) {',
      'const assignments = filterAssignmentsByManagementLine(authUser, repo.listAssignmentsByItem(id));'
    ),
    true,
    "item assignments route must guard subtree read access before loading assignments"
  );
  assert.equal(
    indexServer.includes('app.get("/api/items/:id/assets/cleanup-eligibility", requireRole("admin", "owner"), (req, res) => {\r\n')
      || indexServer.includes('app.get("/api/items/:id/assets/cleanup-eligibility", requireRole("admin", "owner"), (req, res) => {\n'),
    true,
    "assets cleanup eligibility route should still be present"
  );
  assert.equal(
    indexServer.indexOf('app.get("/api/items/:id/assets/cleanup-eligibility", requireRole("admin", "owner"), (req, res) => {')
      < indexServer.indexOf('if (!ensureItemBriefReadAccess(req, res, item)) {', indexServer.indexOf('app.get("/api/items/:id/assets/cleanup-eligibility", requireRole("admin", "owner"), (req, res) => {'))
      && indexServer.indexOf('if (!ensureItemBriefReadAccess(req, res, item)) {', indexServer.indexOf('app.get("/api/items/:id/assets/cleanup-eligibility", requireRole("admin", "owner"), (req, res) => {'))
        < indexServer.indexOf('const report = repo.evaluateContentAssetCleanupEligibility(id, { scope });'),
    true,
    "assets cleanup eligibility must guard subtree read access before evaluating report"
  );
  assert.equal(
    indexServer.indexOf('app.post("/api/items/:id/recheck-export-readiness", requireRole("admin", "owner"), (req, res) => {')
      < indexServer.indexOf('if (!ensureItemBriefReadAccess(req, res, item)) {', indexServer.indexOf('app.post("/api/items/:id/recheck-export-readiness", requireRole("admin", "owner"), (req, res) => {'))
      && indexServer.indexOf('if (!ensureItemBriefReadAccess(req, res, item)) {', indexServer.indexOf('app.post("/api/items/:id/recheck-export-readiness", requireRole("admin", "owner"), (req, res) => {'))
        < indexServer.indexOf('const readiness = buildExportReadiness(id);', indexServer.indexOf('app.post("/api/items/:id/recheck-export-readiness", requireRole("admin", "owner"), (req, res) => {')),
    true,
    "recheck-export-readiness must guard subtree read access before recomputing readiness"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const readiness = buildExportReadiness(id);'),
    true,
    "release-main must guard subtree mutation access before release logic"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const payload = buildReviewIngestPayload({'),
    true,
    "submit-admin-review must guard subtree mutation access before review ingest"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/recompute-readiness-brief", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const snapshot = repo.recomputeReadinessBriefByItem(id, actorEmail(req));'
    ),
    true,
    "recompute-readiness-brief must guard subtree mutation access before recompute"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/intelligence-model", requireRole("admin"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const model = repo.addIntelligenceModel({ ...req.body, content_item_id: id, computed_by: actorEmail(req) });'
    ),
    true,
    "intelligence-model create route must guard subtree mutation access before create"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/recompute-execution-controls", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const snapshot = repo.recomputeExecutionControlsByItem(id, actorEmail(req));'
    ),
    true,
    "recompute-execution-controls must guard subtree mutation access before recompute"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/execution-readiness/evaluate", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const summary = repo.evaluateExecutionReadinessByItem(id);'
    ),
    true,
    "execution-readiness evaluate must guard subtree mutation access before evaluation"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/governance-summary/evaluate", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const summary = repo.buildGovernanceSummaryByItem(id);'
    ),
    true,
    "governance-summary evaluate must guard subtree mutation access before evaluation"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/execution-channels", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const record = repo.createExecutionChannelRecord(payload, actorEmail(req));'
    ),
    true,
    "execution-channels create route must guard subtree mutation access before create"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/execution-channels/:channel/validate-latest", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const result = repo.validateLatestExecutionChannelByItemAndChannel(id, channel, actorEmail(req));'
    ),
    true,
    "execution-channel validate route must guard subtree mutation access before validation"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/execution-channels/:channel/generate", requireRole("admin", "user"), async (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const result = await generateExecutionChannelForItem(repo, id, channel, {'
    ),
    true,
    "execution-channel generate route must guard subtree mutation access before generation"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/search-enrichment", requireRole("admin"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const record = repo.addSearchEnrichmentRecord(id, req.body || {});'
    ),
    true,
    "search-enrichment create route must guard subtree mutation access before create"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/recompute-intelligence", requireRole("admin"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const intelligence = repo.recomputePlaceIntelligence(id);'
    ),
    true,
    "recompute-intelligence route must guard subtree mutation access before recompute"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/social-signals", requireRole("admin"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const signal = repo.addSocialSignalSource(id, req.body || {});'
    ),
    true,
    "social-signals create route must guard subtree mutation access before create"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/momentum/recompute", requireRole("admin"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const snapshot = repo.recomputeMomentumScore(id, platform);'
    ),
    true,
    "momentum recompute route must guard subtree mutation access before recompute"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/recompute-content-direction", requireRole("admin"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const report = repo.recomputeContentDirectionByItem(id);'
    ),
    true,
    "content-direction recompute route must guard subtree mutation access before recompute"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/article-editorial-assignments", requireRole("owner", "admin", "user"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'if (!isExternalAssignee && !canAssignToUserByManagementLine(req.authUser, assigneeId)) {'
    ),
    true,
    "article-editorial-assignments route must guard item subtree before assignee subtree checks"
  );
  assert.equal(
    routeContainsAfter(
      'app.post("/api/items/:id/article-editorial-assignments", requireRole("owner", "admin", "user"), (req, res) => {',
      'if (!isExternalAssignee && !canAssignToUserByManagementLine(req.authUser, assigneeId)) {'
    ),
    true,
    "article-editorial-assignments route must validate assignee management-line scope"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/article-editorial-assignments/:assignmentId/request-revision", requireRole("owner", "admin", "user"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const updatedAssignment = repo.updateAssignmentState(assignmentId, "revision_requested", actorEmail(req), {'
    ),
    true,
    "article assignment request-revision route must guard item subtree before mutation"
  );
  assert.equal(
    routeContainsAfter(
      'app.post("/api/items/:id/article-editorial-assignments/:assignmentId/request-revision", requireRole("owner", "admin", "user"), (req, res) => {',
      'if (!canSeeAssignmentByManagementLine(req.authUser, assignment)) {'
    ),
    true,
    "article assignment request-revision route must validate assignment subtree visibility"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/assignments", requireRole("admin", "user"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'if (!canAssignToUserByManagementLine(req.authUser, assigneeId)) {'
    ),
    true,
    "item assignments create route must guard item subtree before assignee subtree checks"
  );
  assert.equal(
    routeContainsAfter(
      'app.post("/api/items/:id/assignments", requireRole("admin", "user"), (req, res) => {',
      'if (!canAssignToUserByManagementLine(req.authUser, assigneeId)) {'
    ),
    true,
    "item assignments create route must validate assignee management-line scope"
  );
  assert.equal(
    routeGuardBefore(
      'app.post("/api/items/:id/unpublish", requireRole("admin", "owner"), (req, res) => {',
      'if (!ensureItemMutationAccess(req, res, item)) {',
      'const workflowBefore = repo.ensureWorkflowModel(id);'
    ),
    true,
    "unpublish route must guard subtree mutation access before publication mutation"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const result = await rerunProblemTranslations(repo, actorEmail(req), { aiConfig, content_item_id: id });'),
    true,
    "recover-problem-translations must guard subtree mutation access before rerun"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const result = await rerunProblemTranslations(repo, actorEmail(req), {'),
    true,
    "generate-translations must guard subtree mutation access before rerun"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const result = await rerunTranslationRecheck(repo, actorEmail(req), {'),
    true,
    "translation recheck must guard subtree mutation access before rerun"
  );
  assert.equal(
    indexServer.indexOf('if (!ensureItemMutationAccess(req, res, item)) {')
      < indexServer.indexOf('const translation = await repairTranslationFromRecheckIssues(repo, id, lang, aiConfig, actorEmail(req));'),
    true,
    "translation repair must guard subtree mutation access before repair"
  );
});

test("work action permission only allows assignee or external assigner", () => {
  const assigneeActor = canActOnAssignmentWorkForTest({ user: { id: 12 } });
  assert.equal(
    assigneeActor({ assignee_user_id: 12, assigned_by_user_id: 3 }),
    true
  );
  assert.equal(
    assigneeActor({ assignee_user_id: 44, assigned_by_user_id: 12 }),
    false
  );

  const externalAssignerActor = canActOnAssignmentWorkForTest({ user: { id: 3 } });
  assert.equal(
    externalAssignerActor({ assignee_user_id: null, assigned_by_user_id: 3 }),
    true
  );
  assert.equal(
    externalAssignerActor({ assignee_user_id: 12, assigned_by_user_id: 3 }),
    false
  );
});

test("user management UI keeps create-role choices aligned with backend permission", () => {
  const requiredAppSnippets = [
    "const isOwner = isOwnerUser();",
    "const hiddenForNonOwner = !isOwner && (value === \"admin\" || value === \"owner\");",
    "option.hidden = shouldHide;",
    "option.disabled = shouldHide;",
    "if (!isOwner && (selectedRole === \"admin\" || selectedRole === \"owner\")) {",
    'roleSelect.value = "user";',
    'selectedCreateRole === "freelance"',
    '(selectedCreateRole === "user" && isOwnerUser())',
    'payload.managed_by_user_id = parsePositiveInt(state.user?.id, 0) || null;',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `user management UI should align role choices to permission: ${snippet}`);
  }

  const requiredServerSnippets = [
    'if (!isOwnerUser(req.authUser) && (role === "admin" || role === "owner")) {',
    'res.status(403).json({ error: "only owner can create admin or owner users" });',
    'currentRole === "admin" && role === "user"',
    'managed_by_user_id must reference an admin account when role is user',
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `backend policy should remain the source of truth: ${snippet}`);
  }
});

test("manager lookup maps freelance to user managers and user to admin managers", () => {
  const getManagerUsers = getManagerUsersForTest({
    visibleUsers: [
      { id: 1, role: "owner" },
      { id: 2, role: "admin" },
      { id: 3, role: "user" },
      { id: 4, role: "freelance" },
      { id: 5, role: "admin" },
    ],
  });

  assert.deepEqual(
    getManagerUsers("freelance").map((row) => Number(row.id || 0)),
    [3]
  );
  assert.deepEqual(
    getManagerUsers("user").map((row) => Number(row.id || 0)),
    [2, 5]
  );
});

test("user profile picture flow keeps create-form draft isolated from row-level avatar updates", () => {
  const requiredAppSnippets = [
    "async function openUserProfileCropModal(file) {",
    "function updateUserProfileCropZoom(value) {",
    "function rotateUserProfileCrop(direction) {",
    "function startUserProfileCropDrag(event) {",
    "async function buildUserProfileCropResult() {",
    'closeUserProfileCropModal(null);',
    "async function uploadUserProfilePicture(file, options = {}) {",
    "const syncDraft = options && options.syncDraft === false ? false : true;",
    "if (syncDraft) {",
    'const cropped = await openUserProfileCropModal(file);',
    'state.userProfileDraft.picBlob = cropped.blob;',
    'event.target.value = "";',
    'setStatus("user-pic-status", "จัด crop รูปแล้ว จะอัปโหลดตอนกดสร้างผู้ใช้");',
    'setStatus("user-pic-status", "กำลังอัปโหลดรูปที่ crop แล้ว...");',
    'const picAssetId = await uploadUserProfilePicture(cropped.blob, {',
    'setStatus("user-status", `อัปเดตรูปโปรไฟล์ผู้ใช้ ${id} แล้ว (crop เอง + 512x512)`);',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `avatar flow should isolate create draft and support shared crop modal behavior: ${snippet}`);
  }

  const requiredIndexSnippets = [
    '<label>รูปโปรไฟล์ (crop เอง + resize)</label>',
    '<div class="field-help">เลือกรูปแล้วระบบจะเปิดหน้าต่างให้ crop เองแบบสี่เหลี่ยมจัตุรัส พร้อม zoom และหมุน ก่อนย่อเป็น 512x512</div>',
    'id="user-pic-crop-modal"',
    'id="user-pic-crop-canvas"',
    'id="user-pic-crop-zoom"',
    'id="btn-user-pic-crop-rotate-left"',
    'id="btn-user-pic-crop-rotate-right"',
    'id="btn-user-pic-crop-confirm"',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `avatar UI copy should match actual behavior: ${snippet}`);
  }

  const forbiddenAppSnippets = [
    "async function buildUserProfilePictureBlob(file) {",
    'setStatus("user-pic-status", "กำลังครอปกลางภาพอัตโนมัติ + resize + อัปโหลดรูป...");',
    'setStatus("user-status", `อัปเดตรูปโปรไฟล์ผู้ใช้ ${id} แล้ว (ครอปกลางภาพอัตโนมัติ + 512x512)`);',
  ];
  for (const snippet of forbiddenAppSnippets) {
    assert.equal(appJs.includes(snippet), false, `avatar flow should drop legacy auto-crop-only behavior: ${snippet}`);
  }
});

test("assignment assignee label renders from external profile source-of-truth before legacy fallback", () => {
  const requiredAppSnippets = [
    "function getAssignmentAssigneeLabel(assignment) {",
    "const external = row.external_assignee_profile_json && typeof row.external_assignee_profile_json === \"object\"",
    "const externalName = String(external?.name || \"\").trim();",
    "const externalContacts = [",
    "String(external?.phone || \"\").trim(),",
    "String(external?.email || \"\").trim().toLowerCase(),",
    "String(external?.line_id || \"\").trim(),",
    "if (externalName && externalContacts.length > 0) {",
    "return `${externalName} | ${externalContacts.join(\" / \")}`;",
    "const assigneeLabel = getAssignmentAssigneeLabel(assignment);",
    "const assigneeLabel = getAssignmentAssigneeLabel(row);",
    "function getAssignmentAssignerLabel(assignment) {",
    "const directLabel = String(row?.assigned_by_display_name || \"\").trim()",
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment UI should render external assignee label from profile source: ${snippet}`);
  }

  const requiredServerSnippets = [
    "external_assignee_profile_json: assignment?.external_assignee_profile_json || null,",
    "const externalAssigneeProfile = parseJson(row.external_assignee_profile_json, null);",
    "external_assignee_profile_json: externalAssigneeProfile,",
  ];
  const repositoryJs = fs.readFileSync(path.join(collectorRoot, "db", "repository.mjs"), "utf8");
  for (const snippet of requiredServerSnippets) {
    const haystack = snippet.includes("assignment?.external_assignee_profile_json")
      ? indexServer
      : repositoryJs;
    assert.equal(haystack.includes(snippet), true, `assignment data contract should expose external profile source: ${snippet}`);
  }

  assert.equal(
    getAssignmentAssigneeLabel({
      external_assignee_profile_json: {
        name: "ช่างภาพ A",
        phone: "0812345678",
        email: "photo@example.com",
        line_id: "@photoa",
      },
      assignee_display_name: "legacy display",
      assignee_email: "legacy@example.com",
    }),
    "ช่างภาพ A | 0812345678 / photo@example.com / @photoa",
    "assignment label should render from external profile before legacy fallback"
  );

  assert.equal(
    getAssignmentAssigneeLabel({
      external_assignee_profile_json: null,
      assignee_display_name: "",
      assignee_email: "",
      assignee_name: "legacy external",
      assignee_contact: "0811111111",
    }),
    "legacy external",
    "assignment label should still fall back to legacy external fields when profile is absent"
  );
});

test("assignment normalization keeps assignee_email as an email-only field", () => {
  assert.equal(
    normalizeAssignmentRowForTest({
      assignee_user_id: null,
      assignee_contact: "0812345678",
      assignee_email: "0812345678",
      external_assignee_profile_json: JSON.stringify({
        name: "ช่างภาพ B",
        phone: "0812345678",
        line_id: "@photo-b",
      }),
      brief_json: null,
      requirements_json: null,
    }).assignee_email,
    null,
    "phone-only external assignee should not leak into assignee_email"
  );

  assert.equal(
    normalizeAssignmentRowForTest({
      assignee_user_id: null,
      assignee_contact: "legacy@example.com",
      assignee_email: "legacy@example.com",
      external_assignee_profile_json: null,
      brief_json: null,
      requirements_json: null,
    }).assignee_email,
    "legacy@example.com",
    "legacy external email should remain available in assignee_email"
  );

  assert.equal(
    normalizeAssignmentRowForTest({
      assignee_user_id: 7,
      assignee_contact: null,
      assignee_email: "staff@example.com",
      external_assignee_profile_json: null,
      brief_json: null,
      requirements_json: null,
    }).assignee_email,
    "staff@example.com",
    "internal assignee email should stay unchanged"
  );
});

test("repository self-heals assignment-related foreign keys after legacy assignment migration", () => {
  const requiredRepositorySnippets = [
    "function ensureFieldPackAssignmentForeignKeySupport(db) {",
    "const tables = [",
    "content_assignments_legacy_external",
    'name: "field_pack_assignments",',
    'name: "content_assignment_submissions",',
    'name: "content_assignment_submission_deliverables",',
    'name: "content_assignment_handoff_snapshots",',
    "ALTER TABLE ${tableConfig.name} RENAME TO ${tableConfig.legacyName};",
    "FROM ${tableConfig.legacyName};",
    "DROP TABLE ${tableConfig.legacyName};",
    "ensureFieldPackAssignmentForeignKeySupport(db);",
  ];
  for (const snippet of requiredRepositorySnippets) {
    assert.equal(repositoryJs.includes(snippet), true, `repository should self-heal legacy assignment foreign keys: ${snippet}`);
  }
});

test("assignment progress bar keeps theme-aware backgrounds in dark mode", () => {
  const requiredStyleSnippets = [
    ':root[data-theme="dark"] .progress-steps.assignment-progress .step {',
    "background: var(--theme-surface-soft);",
    ':root[data-theme="dark"] .progress-steps.assignment-progress .step.active {',
    "box-shadow: 0 0 0 2px var(--theme-selection);",
    ':root[data-theme="dark"] .progress-steps.assignment-progress .step.completed {',
    ':root[data-theme="dark"] .progress-steps.assignment-progress .dot {',
    "color: var(--muted);",
  ];
  for (const snippet of requiredStyleSnippets) {
    assert.equal(stylesCss.includes(snippet), true, `assignment progress should keep dark-theme override snippet: ${snippet}`);
  }
});

test("assignment progress bar uses theme surface in light mode instead of hard white card backgrounds", () => {
  const requiredStyleSnippets = [
    ".assignment-guide {",
    ".assignment-progress .step {",
    ".assignment-progress .dot {",
    ".assignment-progress .step.completed {",
    ".assignment-progress .step.active {",
    "border: 1px solid var(--line);",
    "background: var(--theme-surface-soft);",
  ];
  for (const snippet of requiredStyleSnippets) {
    assert.equal(stylesCss.includes(snippet), true, `assignment progress should keep light-theme surface snippet: ${snippet}`);
  }
});

test("assignment workflow layout promotes one active workspace and keeps next-step summary visible", () => {
  const requiredIndexSnippets = [
    'id="assignment-context-brief"',
    'id="assignment-next-step-content"',
    'id="assignment-state-workspace-title"',
    'id="assignment-submission-workspace-title"',
    'id="assignment-review-workspace-title"',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `assignment workflow layout should keep required HTML snippet: ${snippet}`);
  }

  const requiredAppSnippets = [
    'node.classList.toggle("is-active", normalizedMode === "active");',
    'node.classList.toggle("is-secondary", normalizedMode === "collapsed");',
    'node.classList.toggle("is-collapsed", normalizedMode === "collapsed");',
    'stateTitle.textContent = effectiveLayout.stateTitle;',
    'submissionTitle.textContent = effectiveLayout.submissionTitle;',
    'reviewTitle.textContent = effectiveLayout.reviewTitle;',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment workflow layout should keep required app snippet: ${snippet}`);
  }
});

test("assignment workflow layout removes duplicate review actions from submitted states and aligns accepted with close step", () => {
  const requiredIndexSnippets = [
    'class="muted assignment-workspace-help"',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `assignment workflow layout should keep helper snippet: ${snippet}`);
  }

  const requiredAppSnippets = [
    'accepted: Object.freeze({',
    "step: 3,",
    'submitted: Object.freeze({',
    'resubmitted: Object.freeze({',
    'stateHelp: "งานถูกส่งกลับมาแล้ว ให้ตรวจงานในขั้นที่ 3"',
    'stateHelp: "งานรอบแก้ถูกส่งกลับมาแล้ว ให้ตรวจงานในขั้นที่ 3"',
    'stateTitle: "เสร็จแล้ว"',
    'reviewTitle: "ขั้นที่ 3: ตรวจงาน"',
    'node.classList.toggle("is-collapsed", normalizedMode === "collapsed");',
    'applySectionState(submissionSection, assignment ? effectiveLayout.submissionMode : "hidden", submissionSummary, summaries.submission);',
    'applySectionState(reviewSection, assignment ? effectiveLayout.reviewMode : "hidden", reviewSummary, summaries.review);',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment workflow layout should keep app snippet: ${snippet}`);
  }

  const requiredStyleSnippets = [
    ".assignment-workspace-section.is-collapsed {",
    ".assignment-workspace-section.is-collapsed .grid,",
    ".assignment-workspace-section.is-collapsed .assignment-deliverables-card,",
    ".assignment-workspace-section.is-collapsed p.muted:not(.assignment-workspace-help) {",
  ];
  for (const snippet of requiredStyleSnippets) {
    assert.equal(stylesCss.includes(snippet), true, `assignment workflow layout should collapse secondary sections with CSS: ${snippet}`);
  }
});

test("assignment process contract uses 2 steps plus completed state in the main workspace", () => {
  const requiredIndexSnippets = [
    '<span class="label">รับงาน / ลงหน้างาน</span>',
    '<span class="label">ส่งผลกลับระบบ</span>',
    '<span class="label">เสร็จแล้ว</span>',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `assignment process contract should keep progress snippet: ${snippet}`);
  }

  const forbiddenIndexSnippets = [
    '<span class="label">ตรวจรับผลงาน</span>',
    '<span class="label">ปิดงาน</span>',
  ];
  for (const snippet of forbiddenIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), false, `assignment process contract should remove legacy progress snippet: ${snippet}`);
  }

  const requiredAppSnippets = [
    'nextAction: "ขั้นถัดไป: เมื่อจบหน้างาน ให้ส่งข้อมูลกลับมาเพื่อตรวจงานในขั้นที่ 3"',
    'nextAction: "งานนี้เสร็จแล้วหลังการตรวจรับผ่าน"',
    'submissionTitle: "ขั้นที่ 2: ลงงาน"',
    'reviewTitle: "ขั้นที่ 3: ตรวจงาน"',
    'nextBody: "รับงานแล้วเริ่มลงงานในขั้นที่ 2 จากนั้นค่อยส่งกลับมาเพื่อตรวจงานในขั้นที่ 3"',
    'nextBody: "ตรวจงานในขั้นที่ 3 แล้วเลือกว่าจะรับงานหรือขอแก้เพิ่ม"',
    'nextTitle: "สถานะงาน"',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment process contract should keep app snippet: ${snippet}`);
  }

  const forbiddenAppSnippets = [
    'stateTitle: "ขั้นที่ 5: ปิดงาน"',
    'submissionTitle: "ขั้นที่ 3: ส่งผลกลับระบบ"',
    'reviewTitle: "ขั้นที่ 4: ตรวจรับผลงาน"',
    'submissionTitle: "ขั้นที่ 2: ส่งผลกลับระบบ"',
    'reviewTitle: "การตรวจรับในขั้นส่งผลกลับระบบ"',
    'nextAction: "ขั้นถัดไป: เมื่อจบหน้างาน ให้ส่งผลกลับระบบในขั้นที่ 2"',
    'nextBody: "ตรวจรับผลงานในขั้นนี้ แล้วเลือกว่าจะรับงานหรือขอแก้เพิ่ม"',
    'nextBody: "รับงานแล้วเริ่มลงหน้างาน จากนั้นค่อยส่งผลกลับระบบในขั้นที่ 3"',
  ];
  for (const snippet of forbiddenAppSnippets) {
    assert.equal(appJs.includes(snippet), false, `assignment process contract should drop legacy app snippet: ${snippet}`);
  }
});

test("assignment route aliases expose separate handoff, work, and review views on the shared panel", () => {
  const requiredIndexSnippets = [
    'id="tab-assignments" data-tab="assignments" data-panel="assignments"',
    'id="assignment-subnav"',
    'id="assignment-mode-handoff" data-assignment-tab="handoff"',
    'id="assignment-mode-work" data-assignment-tab="work"',
    'id="assignment-mode-review" data-assignment-tab="review"',
    'id="assignment-panel-title"',
    'id="assignment-panel-note"',
    '<h2 id="assignment-panel-title" class="section-title">กระบวนการ 2 · ขั้น 1: ส่งงานไปทำ</h2>',
    '<p id="assignment-panel-note" class="muted">เริ่มหลังจบการตรวจแก้และจัดชุดสั่งงาน ใช้สำหรับแสดงชุดลงหน้างาน เลือกผู้รับงาน กำหนดส่ง และส่งงานออกไป</p>',
    '<h4>กระบวนการ 2: ส่งงานไปทำ</h4>',
    '<li>ขั้น 1: ส่งงานไปทำ แสดงชุดลงหน้างาน เลือกผู้รับงาน และส่งออกไปทำ</li>',
    '<li>ขั้น 2: ลงงาน ดูคำสั่งงาน ส่งข้อมูลกลับ และติดตามคอมเมนต์ล่าสุด</li>',
    '<li>ขั้น 3: ตรวจงาน ดูงานที่ส่งกลับมา ขอแก้ หรือรับงานผ่าน</li>',
    '<h3 id="assignment-list-title" class="section-title" style="margin-top:0;">กระบวนการ 2: งานในขั้นลงงาน</h3>',
    'id="assignment-list-title"',
    'id="assignment-list-note"',
    'id="assignment-managed-list-wrap"',
    'id="assignment-managed-list-title"',
    'id="assignment-managed-list-note"',
    'id="table-assignments-managed"',
    'id="assignment-actionable-list-title"',
    'id="assignment-actionable-list-note"',
    'id="assignment-limit-wrap"',
    '<label>ผู้ลงงานในระบบ</label>',
    '<button id="btn-assignments-load" class="primary step-main">1.1 โหลดงานในกระบวนการนี้</button>',
    'id="assignment-list-panel"',
    'id="assignment-submission-form"',
    'id="assignment-submission-files"',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `assignment route alias HTML should exist: ${snippet}`);
  }

  const requiredAppSnippets = [
    "function getDefaultAssignmentPageMode()",
    "function resolvePreferredTab(rawTabValue, currentPreferredTab = state.preferredTab) {",
    "function getAssignmentPageMode()",
    "function isAssignmentWorkOnlyUser() {",
    "function getAssignmentLandingAssignmentId()",
    'if (tabValue === "assignments") {',
    'if ((tabValue === "handoff" || tabValue === "review") && isAssignmentWorkOnlyUser()) {',
    "function isEditorAssignmentBlockedUser() {",
    "function syncAssignmentSubnav() {",
    "function getAssignmentHandoffQueueItems(items = state.items) {",
    "async function selectAssignmentContextItem(itemId, { syncUrl = true } = {}) {",
    "function syncAssignmentPageMode(assignment)",
    "function loadAssignmentByLandingId(assignmentId, { showStatus = true } = {})",
    'const response = await api(`/api/assignments/${targetAssignmentId}`);',
    'if (assignmentPageMode !== "work" && landingAssignmentId && !landingItemId && !state.assignments.assignmentLandingApplied) {',
    'return ["handoff", "work", "review"].includes(currentMode)',
    'state.preferredTab = resolvePreferredTab(rawTabValue);',
    'const targetPanelId = String(tab.dataset.panel || tab.dataset.tab || "").trim();',
    'document.querySelectorAll("[data-assignment-tab]").forEach((node) => {',
    'qs("tab-assignments")?.classList.add("active");',
    'params.set("tab", state.preferredTab);',
    'url: `/?tab=handoff&item_id=${id}`',
    'normalizeDashboardWorkflowStage(item?.workflow_status) !== "cleaned"',
    'isAssignmentContextReady(item?.current_field_pack_status || item?.field_pack_status)',
    'state.assignments.contextItemId = contentItemId;',
    'state.assignments.contextFieldPack = null;',
    'loadAssignmentContextFieldPackStatus(contentItemId)',
    'function renderManagedAssignmentsTable(rows) {',
    'function buildAssignmentsActionablePath() {',
    'function buildAssignmentsManagedPath() {',
    'function getAssignmentAssignerLabel(assignment) {',
    'Number(item?.current_field_pack_id || item?.field_pack_id || 0) > 0',
    '!String(item?.assignment_state || "").trim()',
    'listTitle.textContent = "กระบวนการ 2 · ขั้น 1: เลือกงานที่พร้อมส่งไปทำ";',
    'listNote.textContent = "รายการในคิวนี้คือ item ที่จบตรวจแก้และจัดชุดสั่งงานแล้ว พร้อมส่งเข้า handoff และยังไม่ถูกส่งออกไปทำ";',
    'loadBtn.classList.add("hidden");',
    `tr.innerHTML = '<td colspan="6" class="muted">ยังไม่มีงานที่พร้อมส่งไปทำ</td>';`,
    'data-action="open-handoff-item"',
    'renderManagedAssignmentsTable(state.assignments.managedRows);',
    'renderAssignmentsTable(state.assignments.rows);',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment route alias app snippet should exist: ${snippet}`);
  }
});

test("content preparation process ends at review/edit and hands off into process 2", () => {
  const requiredIndexSnippets = [
    '<p>3 กระบวนการ: เตรียมคอนเทนต์ -> ส่งงานไปทำ -> เผยแพร่และเชื่อมระบบ</p>',
    '<button id="btn-go-assignments" class="primary nav-next">ไปยังกระบวนการส่งงานไปทำ</button>',
    '<span class="muted">ใช้เมื่อต้องส่งต่องานที่จัดชุดสั่งงานแล้ว หรือไปติดตามงานภาคสนาม</span>',
    '<li>4) ตรวจแก้เนื้อหา</li>',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `process boundary HTML should exist: ${snippet}`);
  }

  const forbiddenIndexSnippets = [
    '<li>5) มอบหมายและติดตามงาน</li>',
  ];
  for (const snippet of forbiddenIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), false, `process boundary HTML should drop legacy prep step: ${snippet}`);
  }
});

test("assignment route split keeps direct assignment landing while work-only roles stay out of review lanes", () => {
  const requiredAppSnippets = [
    'assignmentLandingApplied: false,',
    'const assignmentsTab = qs("tab-assignments");',
    'const handoffMode = qs("assignment-mode-handoff");',
    'const workMode = qs("assignment-mode-work");',
    'const reviewMode = qs("assignment-mode-review");',
    'function isAssignmentWorkOnlyUser() {',
    'return role === "freelance" || role === "editor";',
    '? "กระบวนการ 2 · ขั้น 2: ลงงาน"',
    '? hasAssignment && !canActInWork',
    '? "ใช้สำหรับติดตามว่าใครเป็นผู้รับงาน สถานะงานปัจจุบัน และกำหนดส่งของงานนี้"',
    ': "ใช้สำหรับผู้ลงงานเปิดใบสั่งงาน กรอกข้อมูลส่งกลับ แนบรูป/วิดีโอ และส่งงานกลับ"',
    'if (pageMode === "handoff") {',
    'pageSummary.innerHTML = ASSIGNMENT_PROCESS_2_SUMMARY_HTML;',
    'assignmentsTab.classList.toggle("hidden", false);',
    'handoffMode.classList.toggle("hidden", isWorkOnlyRole);',
    'workMode.classList.toggle("hidden", false);',
    'reviewMode.classList.toggle("hidden", isWorkOnlyRole);',
    'if ((tabValue === "handoff" || tabValue === "review") && isAssignmentWorkOnlyUser()) {',
    'return `/api/assignments/mine?scope=actionable&limit=${limit}`;',
    'return `/api/assignments/mine?scope=managed&limit=${limit}`;',
    'return `/api/assignments/mine?assignee_user_id=${selfId}&limit=${limit}`;',
    'if (assignmentPageMode !== "work" && landingAssignmentId && !landingItemId && !state.assignments.assignmentLandingApplied) {',
    'const stillExistsInActionable = rows.some((row) => Number(row.id || 0) === previousSelection);',
    'else if (pageMode === "work" && rows.length > 0) {',
    'if (isAdminUser()) {',
    'return `/api/assignments/mine?limit=${limit}`;',
    'throw new Error("role นี้ตรวจงานไม่ได้");',
    'listPanel.classList.toggle("hidden", pageMode === "review" ? hasAssignment : false);',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment route split should keep app guard snippet: ${snippet}`);
  }

  const requiredServerSnippets = [
    'app.get("/api/items/:id/assignments", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/items/:id/assignments", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/items/:id/approved-context", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'path.match(/^\\/items\\/(\\d+)\\/approved-context$/);',
    'if (String(req.authUser?.role || "").trim().toLowerCase() === "freelance" && !hasItemBriefAccess(req, id, role)) {',
    'app.get("/api/assignments/mine", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {',
    'const authRole = normalizeUserRole(req.authUser?.role, "user");',
    'const scope = String(req.query.scope || "").trim().toLowerCase();',
    'if (scope === "actionable") {',
    'const assignments = buildActionableAssignmentsForActor(req.authUser?.id, limit);',
    'if (scope === "managed") {',
    'const assignments = buildManagedAssignmentsForActor(req.authUser?.id, authRole, limit);',
    'repo.listAssignmentsByScopeUserIds(Array.from(scopeSet), limit)',
    'if (authRole === "freelance" || authRole === "editor") {',
    'if (authRole === "owner" || authRole === "admin") {',
    'const assignments = repo.listAssignments(limit);',
    'app.get("/api/assignments/:id", requireRole("owner", "admin", "editor", "freelance", "user"), (req, res) => {',
    'app.get("/api/assignments/:id/history", requireRole("owner", "admin", "editor", "user", "freelance"), (req, res) => {',
    'res.json({ assignment });',
    'app.get("/api/assignments/:id/submission-decision", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/assignments/:id/submission-decision/evaluate", requireRole("admin", "user"), (req, res) => {',
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `assignment route split should keep server guard snippet: ${snippet}`);
  }

  const forbiddenAppSnippets = [
    'throw new Error("editor ใช้งานเฉพาะระบบทำบทความและเผยแพร่");',
    'state.preferredTab = "raw";',
  ];
  for (const snippet of forbiddenAppSnippets) {
    assert.equal(appJs.includes(snippet), false, `assignment route split should drop legacy app block snippet: ${snippet}`);
  }

  const forbiddenServerSnippets = [
    'app.get("/api/items/:id/assignments", requireRole("admin", "editor", "user"), (req, res) => {',
    'app.post("/api/items/:id/assignments", requireRole("admin", "editor", "user"), (req, res) => {',
    'app.get("/api/assignments/mine", requireRole("freelance", "admin", "editor", "user"), (req, res) => {',
    'if (role === "freelance" || role === "editor") {',
    'app.get("/api/assignments/:id", requireRole("freelance", "admin", "editor", "user"), (req, res) => {',
    'app.get("/api/assignments/:id/history", requireRole("admin", "editor", "user", "freelance"), (req, res) => {',
    'app.get("/api/assignments/:id/submission-decision", requireRole("admin", "editor", "user"), (req, res) => {',
    'app.post("/api/assignments/:id/submission-decision/evaluate", requireRole("admin", "editor", "user"), (req, res) => {',
    'app.get("/api/assignments/:id/submission-decision", requireRole("admin", "editor", "user", "freelance"), (req, res) => {',
    'app.post("/api/assignments/:id/submission-decision/evaluate", requireRole("admin", "editor", "user", "freelance"), (req, res) => {',
    'res.status(403).json({ error: "editor cannot access freelance assignments directly" });',
  ];
  for (const snippet of forbiddenServerSnippets) {
    assert.equal(indexServer.includes(snippet), false, `assignment route split should block freelance review lane snippet: ${snippet}`);
  }
});

test("assignment default page mode treats user as a work-capable assignee while owner still starts in handoff", () => {
  const getDefaultAssignmentPageModeForUser = getDefaultAssignmentPageModeForTest(
    () => "user",
    () => false
  );
  const getDefaultAssignmentPageModeForOwner = getDefaultAssignmentPageModeForTest(
    () => "owner",
    () => false
  );
  const getDefaultAssignmentPageModeForFreelance = getDefaultAssignmentPageModeForTest(
    () => "freelance",
    () => true
  );

  assert.equal(getDefaultAssignmentPageModeForUser(), "work");
  assert.equal(getDefaultAssignmentPageModeForOwner(), "handoff");
  assert.equal(getDefaultAssignmentPageModeForFreelance(), "work");
});

test("refreshAll keeps loading assignments in work or review mode even without an assignee filter", () => {
  const requiredAppSnippets = [
    "const assignmentPageMode = getAssignmentPageMode();",
    'if (assignmentPageMode === "work" || assignmentPageMode === "review" || assigneeSelected) {',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `refreshAll should keep assignment loading active in work/review mode: ${snippet}`);
  }
});

test("assignment tab switches refresh the current workspace instead of changing mode only", () => {
  const requiredAppSnippets = [
    "async function refreshAssignmentWorkspaceForCurrentMode({ showStatus = false } = {}) {",
    'tab.addEventListener("click", async () => {',
    'node.addEventListener("click", async () => {',
    'await refreshAssignmentWorkspaceForCurrentMode({ showStatus: false }).catch((err) => {',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment tab switching should refresh workspace data: ${snippet}`);
  }
});

test("handoff queue uses readiness-aligned item data and excludes items already in assignment flow", () => {
  const requiredServerSnippets = [
    "const currentFieldPack = repo.getCurrentFieldPackByItem(itemId);",
    "const workflow = repo.getWorkflowModelByItem(itemId);",
    'current_field_pack_status: String(currentFieldPack?.status || "").trim().toLowerCase() || null,',
    'assignment_state: String(workflow?.assignment_state || "").trim().toLowerCase() || null,',
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `handoff queue server enrichment should exist: ${snippet}`);
  }

  const requiredAppSnippets = [
    'if (normalizeDashboardWorkflowStage(item?.workflow_status) !== "cleaned") return false;',
    'if (!isAssignmentContextReady(item?.current_field_pack_status || item?.field_pack_status)) return false;',
    'return !String(item?.assignment_state || "").trim();',
    'listTitle.textContent = "กระบวนการ 2 · ขั้น 1: เลือกงานที่พร้อมส่งไปทำ";',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `handoff queue readiness gate should exist: ${snippet}`);
  }
});

test("handoff view keeps the landing item visible even when it has left the ready queue", () => {
  const requiredAppSnippets = [
    'const selectedItem = selectedItemId ? findLoadedItemById(selectedItemId) : null;',
    'const selectedItemInQueue = selectedItemId > 0 && queue.some((item) => Number(item?.id || 0) === selectedItemId);',
    'รายการนี้ถูกเปิดมาจากหน้า editor แต่ไม่ได้อยู่ในคิวพร้อมส่งตอนนี้',
    'if (!queue.length && !(selectedItem && !selectedItemInQueue)) {',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `handoff landing item fallback should exist: ${snippet}`);
  }
});

test("handoff detail view can render field-pack context before an assignment exists", () => {
  const requiredAppSnippets = [
    'function getAssignmentContextItem() {',
    'const hasContextItem = pageMode === "handoff" && Boolean(getAssignmentContextItem());',
    'detailPanel.classList.toggle("hidden", pageMode === "handoff" ? !hasContextItem : !hasAssignment);',
    'function deriveExpectedDeliverablesFromFieldPack(fieldPack) {',
    'if (!brief && !fieldPack) {',
    'const latestState = assignment ? summarizeAssignment(assignment) : "ยังไม่ได้สร้าง assignment";',
    'ตรวจคำสั่งงาน เลือกผู้รับงาน กำหนดส่ง และกด "ส่งงานไปทำ" เพื่อสร้าง assignment ของรายการนี้',
    'กำลังเตรียมส่งงานสำหรับ item #',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `handoff pre-assignment context should exist: ${snippet}`);
  }
});

test("collector index redirects to login when backend auth is missing or expired", () => {
  const requiredAppSnippets = [
    'if (res.status === 401 && path !== "/api/auth/login") {',
    'redirectToLoginWithExpiredSession();',
    'if (!state.token) {',
    'function applyAuthLandingNotice() {',
    'เซสชันหมดอายุหรือ token ใช้ไม่ได้ กรุณาเข้าสู่ระบบใหม่',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `expired auth should redirect to login: ${snippet}`);
  }
});

test("assignment tabs stay visible for admin and owner flows", () => {
  const requiredAppSnippets = [
    'if (["handoff", "work", "review", "assignments"].includes(normalizedPreferredTab)) {',
    'return "tab-assignments";',
    'assignmentsTab.classList.toggle("hidden", false);',
    'targetPanel.classList.remove("hidden");',
    'qs("panel-assignments")?.classList.remove("hidden");',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `admin assignment navigation should stay visible: ${snippet}`);
  }

  const forbiddenAppSnippets = [
    'if (isAdminUser() && ["raw", "handoff", "work", "review", "assignments"].includes(normalizedPreferredTab)) {',
    'assignmentsTab.classList.toggle("hidden", isAdminUser());',
  ];
  for (const snippet of forbiddenAppSnippets) {
    assert.equal(appJs.includes(snippet), false, `admin assignment navigation should not be hidden: ${snippet}`);
  }
});

test("assignment top tab keeps explicit work or review sub-mode instead of resetting to handoff", () => {
  const resolvePreferredTab = resolvePreferredTabForTest(() => "handoff", { preferredTab: "work" });
  assert.equal(
    resolvePreferredTab("assignments"),
    "work",
    "opening the assignments top tab should preserve an explicit work landing"
  );
  assert.equal(
    resolvePreferredTab("review", "work"),
    "review",
    "explicit sub-nav clicks should still switch to the requested mode"
  );
  assert.equal(
    resolvePreferredTab("assignments", "raw"),
    "handoff",
    "plain assignments entry should still fall back to the default mode when no assignment sub-mode is set"
  );
});

test("assignment work access allows assigned accounts across roles while assign target policy stays narrow", () => {
  const requiredServerSnippets = [
    'if (assignmentAssigneeId === actorId) return true;',
    'if (role === "user") return isFreelanceManagedByUser(actorId, assignmentAssigneeId);',
    'const authRole = normalizeUserRole(req.authUser?.role, "user");',
    'if (authRole === "freelance" || authRole === "editor") {',
    'if (role === "user" && assigneeId && !isFreelanceManagedByUser(req.authUser?.id, assigneeId)) {',
    'res.status(403).json({ error: "user can assign work only to managed freelance accounts" });',
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `assignment access policy should keep snippet: ${snippet}`);
  }

  const requiredRepositorySnippets = [
    'function listAssignments(limit = 50) {',
  ];
  for (const snippet of requiredRepositorySnippets) {
    assert.equal(repositoryJs.includes(snippet), true, `assignment access repository should keep snippet: ${snippet}`);
  }

  const requiredAppSnippets = [
    'return visibleUsers.filter((row) => Number(row?.id || 0) > 0);',
    'const placeholder = options.length ? "-- เลือกผู้รับงาน --" : "-- ยังไม่มี account ที่เลือกได้ --";',
    'const label = String(row?.display_name || "").trim() || String(row?.email || "").trim();',
    'return `<option value="${id}">${escapeHtml(label || `user #${id}`)}</option>`;',
    'function renderAssignmentAssigneeSelectionSummary(secondaryText = "") {',
    'const avatarUrl = String(user?.avatar_url || "").trim();',
    'class="assignment-inline-user-avatar"',
    'renderAssignmentAssigneeSelectionSummary("ยังไม่มีงานในกระบวนการนี้");',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment assignee UI should keep snippet: ${snippet}`);
  }

  const forbiddenAppSnippets = [
    '-- ยังไม่มี freelance ที่เลือกได้ --',
    'freelance #${id}',
  ];
  for (const snippet of forbiddenAppSnippets) {
    assert.equal(appJs.includes(snippet), false, `assignment assignee UI should drop legacy freelance-only snippet: ${snippet}`);
  }

  const requiredStyleSnippets = [
    '.assignment-inline-user {',
    '.assignment-inline-user-avatar {',
    '.assignment-inline-user-avatar-placeholder {',
  ];
  for (const snippet of requiredStyleSnippets) {
    assert.equal(stylesCss.includes(snippet), true, `assignment assignee summary should include style snippet: ${snippet}`);
  }
});

test("assignment assignee selection summary keeps avatar and name visible even when there is no assignment yet", () => {
  const renderAssignmentAssigneeSelectionSummary = new Function(
    "qs",
    "getAssignableFreelancers",
    `${extractNamedFunctionSource(appJs, "parsePositiveInt")}
${extractNamedFunctionSource(appJs, "escapeHtml")}
${extractNamedFunctionSource(appJs, "getSelectedAssignmentAssigneeUser")}
${extractNamedFunctionSource(appJs, "renderAssignmentAssigneeSelectionSummary")}
return renderAssignmentAssigneeSelectionSummary;`
  )(
    (id) => {
      if (id === "assignment-assignee-id") return { value: "12" };
      if (id === "assignment-selected-summary") return summaryNode;
      return null;
    },
    () => [
      { id: 12, display_name: "Alice", avatar_url: "/media/alice.jpg" },
    ]
  );

  const summaryNode = { textContent: "", innerHTML: "" };
  renderAssignmentAssigneeSelectionSummary("ยังไม่มีงานในกระบวนการนี้");

  assert.equal(summaryNode.textContent, "");
  assert.match(summaryNode.innerHTML, /Alice/);
  assert.match(summaryNode.innerHTML, /\/media\/alice\.jpg/);
  assert.match(summaryNode.innerHTML, /ยังไม่มีงานในกระบวนการนี้/);
});

test("assignment filter select does not auto-select a lone assignee option", () => {
  const assignmentFilterNode = {
    id: "assignment-assignee-id",
    value: "",
    innerHTML: "",
    disabled: false,
  };
  const createNode = {
    id: "assignment-create-assignee-id",
    value: "",
    innerHTML: "",
    disabled: false,
  };
  let syncCalled = 0;

  const renderAssignmentAssigneeOptions = new Function(
    "qs",
    "getAssignableFreelancers",
    "escapeHtml",
    "syncAssignmentCreateAssigneeMode",
    `${extractNamedFunctionSource(appJs, "renderAssignmentAssigneeOptions")}
return renderAssignmentAssigneeOptions;`
  )(
    (id) => {
      if (id === "assignment-assignee-id") return assignmentFilterNode;
      if (id === "assignment-create-assignee-id") return createNode;
      return null;
    },
    () => [{ id: 12, display_name: "Alice", email: "alice@example.com" }],
    (value) => String(value),
    () => {
      syncCalled += 1;
    }
  );

  renderAssignmentAssigneeOptions();

  assert.equal(assignmentFilterNode.value, "", "assignment filter should stay blank by default");
  assert.equal(createNode.value, "12", "create-assignment select should still auto-select the only option");
  assert.equal(syncCalled, 1);
});

test("content preparation queue only shows items that are still in process 1", () => {
  const requiredAppSnippets = [
    "function getPreparationQueueItems(items = state.items) {",
    'const stage = normalizeDashboardWorkflowStage(item?.workflow_status);',
    'if (String(item?.assignment_state || "").trim()) return false;',
    'if (stage === "generated" || stage === "published") return false;',
    'if (stage === "cleaned" && isAssignmentContextReady(item?.current_field_pack_status || item?.field_pack_status)) {',
    'return stage === "raw" || stage === "cleaned";',
    "const rows = getPreparationQueueItems(items);",
    "const list = sortRawItems(getPreparationQueueItems(items));",
    'const activeStageFilter = DASHBOARD_STAGE_FILTERS.some((filter) => filter.value === requestedStageFilter)',
    'state.dashboard.rawStageFilter = activeStageFilter;',
    'Object.freeze({ value: "cleaned", label: "ตรวจแก้/จัดชุดสั่งงาน" }),',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `content preparation queue gate should exist: ${snippet}`);
  }

  const forbiddenAppSnippets = [
    'Object.freeze({ value: "generated", label: "ส่งงานไปทำ/กำลังดำเนินการ" }),',
    'Object.freeze({ value: "published", label: "เผยแพร่แล้ว" }),',
  ];
  for (const snippet of forbiddenAppSnippets) {
    assert.equal(appJs.includes(snippet), false, `content preparation queue should drop downstream stage filter: ${snippet}`);
  }
});

test("work lane keeps only contributor-facing scope", () => {
  const requiredAppSnippets = [
    "const ASSIGNMENT_PROCESS_2_SUMMARY_HTML = `",
    "function canActOnAssignmentWork(assignment) {",
    "function getAssignmentSubmissionFormAssignment(assignment, pageMode = getAssignmentPageMode()) {",
    "function renderAssignmentWorkMonitor(assignment) {",
    "renderAssignmentContextBrief(assignment);",
    "renderAssignmentWorkMonitor(assignment);",
    'if (pageMode === "work") {',
    'pageSummary.classList.add("hidden");',
    'pageSummary.innerHTML = "";',
    'selectedSummary.classList.toggle("hidden", pageMode === "work");',
    'guideBox.classList.toggle("hidden", pageMode === "work");',
    'contextBriefCard.classList.toggle("hidden", pageMode === "work");',
    'nextStepCard.classList.toggle("hidden", pageMode === "work");',
    'debugBox.classList.toggle("hidden", pageMode === "work");',
    'const effectiveLayout = pageMode === "work" && assignment',
    'submissionTitle: "ขั้นที่ 2: ติดตามงาน",',
    'submissionHelp: "ส่วนนี้ใช้สำหรับติดตามผู้รับงาน สถานะปัจจุบัน กำหนดส่ง และเปิดใบสั่งงาน",',
    'submissionMode: "active",',
    'submissionForm.classList.toggle("hidden", pageMode === "review" || (pageMode === "work" && hasAssignment && !canActInWork));',
    'workMonitor.classList.toggle("hidden", pageMode !== "work" || !hasAssignment || canActInWork);',
    'deliverablesCard.classList.toggle("hidden", pageMode === "work" && hasAssignment && !canActInWork);',
    'renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(getAssignmentById(state.assignments.selectedId)));',
    'renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(getAssignmentById(assignmentId)));',
    'renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(assignment, pageMode));',
    'renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(selectedAssignment, pageMode));',
    "function buildAssignmentSubmissionArticlePayload() {",
    'verified_answers: readAssignmentSubmissionPromptAnswers("verified_answers"),',
    'question_answers: readAssignmentSubmissionPromptAnswers("question_answers"),',
    'additional_text: String(qs("assignment-submission-additional-text")?.value || "").trim(),',
    'api(`/api/assignments/${assignmentId}/assets/upload`, {',
    'api(`/api/assignments/${assignmentId}/submissions/${submissionId}/deliverables`, {',
    'params.set("tab", "review");',
    'listNote.textContent = pageMode === "review"',
    'แยกตารางบนสำหรับติดตาม และตารางล่างสำหรับงานที่ account นี้ต้องลงมือทำจริง',
    'actionableTitle.classList.toggle("hidden", pageMode !== "work");',
    'loadBtn.textContent = pageMode === "work" ? "โหลดรายการงาน" : "1.1 โหลดงานในกระบวนการนี้";',
    '>ติดตามงาน</button>',
    '>เปิดงาน</button>',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `work lane contributor scope snippet should exist: ${snippet}`);
  }

  const forbiddenAppSnippets = [
    "ผู้ตรวจขอแก้เพิ่ม ให้ลงงานและส่งกลับอีกครั้ง",
    "ส่งข้อมูลกลับแล้ว รอตรวจงาน",
    "โหลด PDF และส่งข้อมูลกลับ",
    'renderAssignmentSubmissionForm(getAssignmentById(state.assignments.selectedId));',
    'renderAssignmentSubmissionForm(getAssignmentById(assignmentId));',
    'const contributorNote = String(qs("assignment-submission-note")?.value || "").trim();',
    'if (pageMode === "work" && fieldPack) {',
    '<div class="assignment-brief-label">ชุดลงหน้างาน</div>',
    '<div class="assignment-brief-label">ใบสั่งงาน (มุมมองพิมพ์)</div>',
    "1.2 เปิดงาน",
    "ปล่อยว่างเพื่อดูงานภายนอกที่คุณเป็นคนสั่ง",
  ];
  for (const snippet of forbiddenAppSnippets) {
    assert.equal(appJs.includes(snippet), false, `work lane should drop synthetic or false promise snippet: ${snippet}`);
  }

  const requiredIndexSnippets = [
    'ขั้น 2: ลงงาน ดูคำสั่งงาน ส่งข้อมูลกลับ และติดตามคอมเมนต์ล่าสุด',
    'id="assignment-managed-list-wrap"',
    'id="assignment-managed-list-title"',
    'id="assignment-managed-list-note"',
    'id="table-assignments-managed"',
    'id="assignment-actionable-list-title"',
    'id="assignment-actionable-list-note"',
    'id="assignment-submission-brief-link"',
    'id="assignment-work-monitor"',
    'id="assignment-work-monitor-summary"',
    'id="assignment-work-monitor-note"',
    'id="assignment-work-monitor-brief-link"',
    'id="assignment-submission-verified-fields"',
    'id="assignment-submission-question-fields"',
    'id="assignment-submission-capture-guide"',
    'id="assignment-submission-additional-text"',
    'id="assignment-submission-files"',
    '<button id="btn-assignment-submit" class="step-main">ส่งงานกลับ</button>',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `work lane HTML should keep contributor-only snippet: ${snippet}`);
  }

  const forbiddenIndexSnippets = [
    'id="assignment-submission-action"',
    'id="assignment-submission-reason"',
    'id="assignment-submission-note"',
    'id="assignment-deliverable-type"',
    'id="btn-assignment-load-submissions"',
    'id="btn-assignment-load-history"',
  ];
  for (const snippet of forbiddenIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), false, `work lane HTML should drop review-only status snippet: ${snippet}`);
  }
});

test("work lane submission form renders prompt fields from field pack and uploads media through assignment-scoped endpoint", () => {
  const requiredAppSnippets = [
    "function getFieldPackPromptGroups(fieldPack = null) {",
    'const { mustVerify, mustCapture, mustAsk } = getFieldPackPromptGroups(fieldPack);',
    'const articlePayload = getAssignmentSubmissionPrefillPayload(assignment, fieldPack);',
    'buildAssignmentSubmissionPromptInputs(mustVerify, "verified_answers", articlePayload.verified_answers)',
    'buildAssignmentSubmissionPromptInputs(mustAsk, "question_answers", articlePayload.question_answers)',
    'renderAssignmentBriefList(mustCapture, "ยังไม่ได้ระบุ")',
    'body.article_payload_json = articlePayload;',
    'writeAssignmentSubmissionDraft(assignmentId, articlePayload);',
    'state.assignments.latestUploadedAssets = uploadedAssets;',
    'อัปโหลดเข้าระบบแล้ว ${uploadedAssets.length} ไฟล์',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `work lane prompt mapping should exist: ${snippet}`);
  }

  const requiredServerSnippets = [
    'app.post("/api/assignments/:id/assets/upload"',
    'if (!hasAssignmentSubmissionAccess(req, assignment)) {',
    'if (!isSupportedMediaSignature(fileBuffer, String(file.mimetype || "").toLowerCase())) {',
    'assignment.asset.upload',
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `assignment-scoped upload endpoint should exist: ${snippet}`);
  }
});

test("review lane keeps only returned work plus review controls", () => {
  const requiredIndexSnippets = [
    'id="assignment-deliverables-summary"',
    'id="assignment-review-note"',
    '<button id="btn-assignment-request-revision" class="warn step-main">ขอแก้เพิ่ม</button>',
    '<button id="btn-assignment-accept-submission" class="primary step-main">รับงานผ่าน</button>',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `review lane HTML should keep snippet: ${snippet}`);
  }

  const requiredAppSnippets = [
    'submissionForm.classList.toggle("hidden", pageMode === "review" || (pageMode === "work" && hasAssignment && !canActInWork));',
    'reviewWorkspace.classList.toggle("hidden", pageMode !== "review");',
    'submissionTitle: "งานที่ส่งกลับมา"',
    'function buildEvaluatePayloadFromForm() {',
    'const reviewNote = String(qs("assignment-review-note")?.value || "").trim();',
    'payload.contributor_note = reviewNote;',
    "async function applyAssignmentReviewDecision(action) {",
    'payload.action = selectedAction;',
    "await applyAssignmentReviewDecision(\"request_revision\");",
    "await applyAssignmentReviewDecision(\"accept_submission\");",
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `review lane app snippet should exist: ${snippet}`);
  }

  const forbiddenIndexSnippets = [
    '<button id="btn-evaluate-submission" class="warn step-main">ตรวจรับงานส่งรอบนี้</button>',
  ];
  for (const snippet of forbiddenIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), false, `review lane HTML should drop legacy evaluate-only snippet: ${snippet}`);
  }
});

test("step 1 handoff view keeps only the six agreed pre-submit blocks and redirects into work after send", () => {
  const requiredIndexSnippets = [
    'id="assignment-page-summary"',
    'class="readiness-alert ready hidden" id="assignment-page-summary"',
    '<h3 class="section-title" style="margin-top:0;">กระบวนการ 2 · ขั้น 1: ส่งงานไปทำ</h3>',
    '<h4 class="assignment-subtitle" style="margin-top:0;">ข้อมูลงานสั้น ๆ</h4>',
    'id="assignment-create-summary" class="assignment-brief-empty"',
    '<h4 class="assignment-subtitle" style="margin-top:0;">คำสั่งงานที่จะส่งออก</h4>',
    'id="assignment-handoff-brief"',
    'id="assignment-create-assignee-mode"',
    'id="assignment-create-assignee-internal-wrap"',
    'id="assignment-create-assignee-external-wrap"',
    'id="assignment-create-assignee-contact-wrap"',
    'id="assignment-create-assignee-name"',
    'id="assignment-create-assignee-phone"',
    'id="assignment-create-assignee-email"',
    'id="assignment-create-assignee-line-id"',
    '<label>ผู้รับงาน</label>',
    '<label>กำหนดส่ง</label>',
    '<option value="day_1">+1 วัน</option>',
    '<option value="day_3">+3 วัน</option>',
    '<option value="day_7">+7 วัน</option>',
    '<option value="week_1">+1 สัปดาห์</option>',
    '<option value="week_2">+2 สัปดาห์</option>',
    '<option value="week_3">+3 สัปดาห์</option>',
    '<option value="month_1">+1 เดือน</option>',
    '<label>หมายเหตุถึงผู้รับงาน</label>',
    '<button id="btn-assignment-create" class="primary step-main">ส่งงานไปทำ</button>',
    'class="assignment-workspace-section hidden"',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `step 1 handoff HTML should keep required block: ${snippet}`);
  }

  const forbiddenIndexSnippets = [
    '<h3 class="section-title" style="margin-top:0;">สร้างงานมอบหมายสำหรับรายการนี้</h3>',
    '<button id="btn-assignment-create" class="primary step-main">1.0 สร้างงานมอบหมาย</button>',
  ];
  for (const snippet of forbiddenIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), false, `step 1 handoff HTML should drop legacy block: ${snippet}`);
  }

  const requiredAppSnippets = [
    'function ensureAssignmentHandoffLayoutOrder() {',
    'if (pageMode === "handoff") {',
    'ensureAssignmentHandoffLayoutOrder();',
    'pageSummary.classList.remove("hidden");',
    'detailPanel.classList.toggle("hidden", pageMode === "handoff" ? true : !hasAssignment);',
    'contextFieldPack: null,',
    'contextFieldPackLoadFailed: false,',
    'function syncAssignmentCreateAssigneeMode() {',
    'const mode = String(qs("assignment-create-assignee-mode")?.value || "internal").trim().toLowerCase();',
    'const externalAssigneeName = String(qs("assignment-create-assignee-name")?.value || "").trim();',
    'const externalAssigneePhone = String(qs("assignment-create-assignee-phone")?.value || "").trim();',
    'const externalAssigneeEmail = String(qs("assignment-create-assignee-email")?.value || "").trim().toLowerCase();',
    'const externalAssigneeLineId = String(qs("assignment-create-assignee-line-id")?.value || "").trim();',
    'payload.external_assignee_profile_json = {',
    'payload.assignee_name = externalAssigneeName;',
    'payload.assignee_contact = externalAssigneePhone || externalAssigneeEmail || externalAssigneeLineId || "";',
    'throw new Error("กรุณากรอกชื่อและข้อมูลติดต่ออย่างน้อย 1 ช่องทางของผู้รับงานภายนอก");',
    'function buildAssignmentMonthEndOfDay(baseDate, monthsToAdd) {',
    'if (preset === "day_1" || preset === "day_3" || preset === "day_7") {',
    'if (preset === "week_1" || preset === "week_2" || preset === "week_3") {',
    'if (preset === "month_1") {',
    'new Date(targetMonthDate.getFullYear(), targetMonthDate.getMonth(), targetDay, 23, 59, 59, 999);',
    'function renderAssignmentCreateSummary() {',
    'renderAssignmentHandoffBrief();',
    'renderAssignmentCreateSummary();',
    'state.assignments.contextFieldPackLoadFailed = false;',
    'state.assignments.contextFieldPackLoadFailed = true;',
    'function renderAssignmentHandoffBrief() {',
    'function formatAssignmentContextFieldPackStatusLabel(status) {',
    'if (value === "field_in_progress") return "กำลังลงหน้างาน";',
    'if (value === "field_done") return "ลงหน้างานแล้ว";',
    'if (value === "on_hold") return "พักไว้";',
    'return "ไม่ทราบสถานะ";',
    'const node = qs("assignment-handoff-brief");',
    'const fieldPack = state.assignments.contextFieldPack',
    'const node = qs("assignment-create-summary");',
    'const hasCurrentFieldPack = Boolean(state.assignments.contextFieldPack);',
    ': "ยังไม่มีชุดลงหน้างานปัจจุบัน";',
    'const fieldPackStatus = state.assignments.contextFieldPackLoadFailed',
    '<div class="assignment-brief-label">รายการ</div>',
    '<div class="assignment-brief-label">ชื่อคอนเทนต์</div>',
    '<div class="assignment-brief-label">หมวดหมู่</div>',
    '<div class="assignment-brief-label">ภาษา</div>',
    '<div class="assignment-brief-label">สถานะชุดลงหน้างาน</div>',
    'if (state.assignments.contextFieldPackLoadFailed) {',
    'node.innerHTML = "โหลดชุดคำสั่งงานปัจจุบันไม่สำเร็จ";',
    'const summary = String(fieldPack.editor_summary || fieldPack.ai_summary || "").trim();',
    'const socialHook = String(fieldPack.social_hook || "").trim();',
    'const socialCaptionAngle = String(fieldPack.social_caption_angle || "").trim();',
    'const socialShotEmphasis = Array.isArray(fieldPack.social_shot_emphasis_json)',
    'const socialOnCameraPoints = Array.isArray(fieldPack.social_on_camera_points_json)',
    '<div class="assignment-brief-label">แนวเล่า social</div>',
    '<strong>จุด hook:</strong>',
    '<strong>แนว caption:</strong>',
    '<div class="assignment-brief-label" style="margin-top:8px;">ช็อตที่ควรเน้น</div>',
    '<div class="assignment-brief-label" style="margin-top:8px;">ประเด็นพูดหน้ากล้อง</div>',
    'if (pageMode === "handoff") {',
    'pageSummary.innerHTML = ASSIGNMENT_PROCESS_2_SUMMARY_HTML;',
    'params.set("item_id", String(itemId));',
    'window.location.assign(`${window.location.pathname}${query ? `?${query}` : ""}`);',
    'throw new Error("role นี้ไม่มีสิทธิ์ส่งงานไปทำ");',
    'throw new Error("ยังไม่ได้เลือกรายการที่จะส่งงานไปทำ");',
    'throw new Error("ระบบไม่ส่ง assignment id กลับมา");',
    'if (selfId && (!assigneeId || assigneeId === selfId)) {',
    'if (!assignment) return "ยังไม่ได้เลือกงานในกระบวนการนี้";',
    'return `งาน #${id} | item=${contentItemId} | assignee=${assigneeLabel} | state=${stateValue}`;',
    'node.innerHTML = "เลือกงานในกระบวนการนี้เพื่อดูคำสั่งงานของงานนี้";',
    'metaNode.textContent = "ยังไม่ได้เลือกงานในกระบวนการนี้";',
    'node.innerHTML = "ยังไม่มีข้อมูลงานส่งของงานที่เลือก";',
    "tr.innerHTML = '<td colspan=\"7\" class=\"muted\">ยังไม่มีงานในกระบวนการนี้</td>';",
    'qs("assignment-selected-summary").textContent = "ยังไม่ได้เลือกงานในกระบวนการนี้";',
    'renderAssignmentAssigneeSelectionSummary("ยังไม่มีงานในกระบวนการนี้");',
    'setStatus("assignment-status", `โหลดรายการงานสำเร็จ ${rows.length} รายการ${totalManaged}`);',
    'summaryNode.textContent = `ยังไม่มีงานของ item #${targetItemId} ในกระบวนการนี้`;',
    'setStatus("assignment-status", `โหลดงานของ item #${targetItemId} แล้ว แต่ยังไม่มีรายการในกระบวนการนี้`);',
    'setStatus("assignment-status", `โหลดงานของ item #${targetItemId} แล้ว ${rows.length} รายการ`);',
    'setStatus("assignment-status", `โหลดงาน #${targetAssignmentId} แล้ว`);',
    'throw new Error("กรุณาเลือกงานก่อน");',
    'setStatus("assignment-status", `โหลดรายการรอบส่งงานของงาน #${assignmentId} แล้ว`);',
    'setStatus("assignment-status", `โหลดข้อมูลงานส่งของงาน #${assignmentId} แล้ว${missingCount > 0 ? ` | ยังขาด ${missingCount}` : ""}`);',
    'setStatus("assignment-status", `โหลดประวัติการเปลี่ยนแปลงของงาน #${assignmentId} แล้ว`);',
    'throw new Error("role นี้ไม่มีสิทธิ์เปลี่ยนสถานะงานนี้");',
    'setStatus("assignment-status", `อัปเดตงาน #${assignmentId} เป็น ${result?.assignment?.state || "-"}`);',
    '? "เลือกผู้ลงงานแล้วกดโหลดงานในกระบวนการนี้"',
    'nextAction: "ขั้นถัดไป: เริ่มลงงานตามคำสั่งงานในขั้นที่ 2"',
    'nextAction: "ขั้นถัดไป: เมื่อจบหน้างาน ให้ส่งข้อมูลกลับมาเพื่อตรวจงานในขั้นที่ 3"',
    'nextAction: "ขั้นถัดไป: ตรวจงานที่ส่งกลับมาในขั้นที่ 3"',
    'nextAction: "ขั้นถัดไป: ตรวจงานรอบแก้ในขั้นที่ 3"',
    'nextAction: "ผลตรวจยังไม่ผ่าน: กลับไปลงงานและส่งกลับมาอีกครั้งในขั้นที่ 2"',
    'stateHelp: "งานถูกส่งออกไปแล้ว ขั้นถัดไปคือเริ่มลงงานในกระบวนการ 2"',
    'stateHelp: "งานอยู่ระหว่างลงงาน โดยปกติขั้นถัดไปคือส่งข้อมูลกลับมาเพื่อตรวจงาน"',
    'stateHelp: "งานถูกส่งกลับมาแล้ว ให้ตรวจงานในขั้นที่ 3"',
    'stateHelp: "งานถูกขอแก้เพิ่มแล้ว ถ้าจะเดินต่อให้กลับไปลงงานและส่งกลับมาอีกครั้ง"',
    'stateHelp: "งานรอบแก้ถูกส่งกลับมาแล้ว ให้ตรวจงานในขั้นที่ 3"',
    'selectedItemId === id ? "row-selected" : ""',
    '<button type="button" data-action="open-handoff-item" data-id="${id}">1.1 เลือกงาน</button>',
    'return `<span class="workflow-badge workflow-badge-generated" title="workflow_status: ${rawLabel}">ส่งงานไปทำ/กำลังดำเนินการ</span>`;',
    'label: "ไปส่งงานไปทำ"',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `step 1 handoff app logic should exist: ${snippet}`);
  }

  const forbiddenAppSnippets = [
    '? "ขั้น 1.5: ลงงาน"',
    '? "ขั้น 2: ตรวจงาน"',
    '? "ใช้สำหรับดูคำสั่งงาน โหลด PDF และส่งข้อมูลกลับ"',
    'nextAction: "ขั้นถัดไป: เมื่อจบหน้างาน ให้ส่งผลกลับระบบในขั้นที่ 2"',
    'nextAction: "ขั้นถัดไป: ตรวจรับผลงานในขั้นส่งผลกลับระบบ"',
    'nextAction: "ขั้นถัดไป: ตรวจรับผลงานที่ส่งแก้แล้วในขั้นส่งผลกลับระบบ"',
    'nextAction: "ผลตรวจยังไม่ผ่าน: ให้แก้และส่งกลับมาอีกครั้งในขั้นนี้"',
    'setStatus(\n    "assignment-create-status",\n    `สร้างงานมอบหมาย #${Number(result?.assignment?.id || 0) || "-"} สำหรับ item #${itemId} สำเร็จ`\n  );',
    'setStatus("assignment-create-status", `ส่งงานไปทำสำหรับ item #${itemId} สำเร็จ`);',
    'await loadAssignmentsByItem(itemId, { showStatus: false, preserveSelection: false });',
    'throw new Error("role นี้ไม่มีสิทธิ์สร้างงานมอบหมาย");',
    'throw new Error("ยังไม่ได้เลือกรายการที่จะสร้างงานมอบหมาย");',
    'function buildFieldPackHandoffBrief(fieldPack = null) {',
    'const handoffBrief = buildFieldPackHandoffBrief(fieldPack);',
    'const expectedDeliverables = normalizeAssignmentBriefExpectedDeliverables(handoffBrief);',
    'createSummary.textContent = `item #${contextItemId}${item?.title ? ` | ${item.title}` : ""}`;',
    '<div class="assignment-brief-label">สิ่งที่คาดว่าจะต้องส่งกลับ</div>',
    'throw new Error("กรุณาเลือกผู้รับงานก่อนโหลดงานมอบหมาย");',
    'if (!assignment) return "ยังไม่ได้เลือกงานมอบหมาย";',
    'return `งานมอบหมาย #${id} | item=${contentItemId} | assignee=${assigneeUserId} | state=${stateValue}`;',
    'node.innerHTML = "เลือกงานมอบหมายเพื่อดูคำสั่งงานของงานนี้";',
    'metaNode.textContent = "ยังไม่ได้เลือกงานมอบหมาย";',
    'node.innerHTML = "ยังไม่มีข้อมูลงานส่งของงานมอบหมายที่เลือก";',
    "tr.innerHTML = '<td colspan=\"7\" class=\"muted\">ยังไม่มีงานมอบหมาย</td>';",
    '...(String(fieldPack.field_notes || "").trim() ? ["raw_notes"] : []),',
    '...(Array.isArray(fieldPack.social_on_camera_points_json) && fieldPack.social_on_camera_points_json.some((value) => String(value || "").trim())',
    'fieldPack.story_angle,',
    'fieldPack.field_notes,',
    'if (socialHook) socialAngle.push(',
    'const fieldPackStatus = state.assignments.contextFieldPackLoadFailed\n    ? "โหลดไม่สำเร็จ"\n    : formatAssignmentContextFieldPackStatusLabel(state.assignments.contextFieldPackStatus);',
  ];
  for (const snippet of forbiddenAppSnippets) {
    assert.equal(appJs.includes(snippet), false, `step 1 handoff app logic should drop legacy behavior: ${snippet}`);
  }
});

test("review-like assignment APIs no longer allow freelance access", () => {
  const requiredServerSnippets = [
    'app.get("/api/assignments/:id/deliverables/utility-readiness", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/assignments/:id/deliverables/utility-readiness/evaluate", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/assignments/:id/deliverables/review-decision", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/assignments/:id/deliverables/review-decision/evaluate", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/assignments/:id/deliverables/governance-summary", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/assignments/:id/deliverables/governance-summary/evaluate", requireRole("admin", "user"), (req, res) => {',
    'app.get("/api/assignments/:id/handoff-governance", requireRole("admin", "user"), (req, res) => {',
    'app.post("/api/assignments/:id/handoff-governance/evaluate", requireRole("admin", "user"), (req, res) => {',
  ];
  for (const snippet of requiredServerSnippets) {
    assert.equal(indexServer.includes(snippet), true, `review-like assignment API should keep narrowed role snippet: ${snippet}`);
  }

  const forbiddenServerSnippets = [
    'app.get("/api/assignments/:id/deliverables/utility-readiness", requireRole("admin", "user", "freelance"), (req, res) => {',
    'app.post("/api/assignments/:id/deliverables/utility-readiness/evaluate", requireRole("admin", "user", "freelance"), (req, res) => {',
    'app.get("/api/assignments/:id/deliverables/review-decision", requireRole("admin", "user", "freelance"), (req, res) => {',
    'app.post("/api/assignments/:id/deliverables/review-decision/evaluate", requireRole("admin", "user", "freelance"), (req, res) => {',
    'app.get("/api/assignments/:id/deliverables/governance-summary", requireRole("admin", "user", "freelance"), (req, res) => {',
    'app.post("/api/assignments/:id/deliverables/governance-summary/evaluate", requireRole("admin", "user", "freelance"), (req, res) => {',
    'app.get("/api/assignments/:id/handoff-governance", requireRole("admin", "user", "freelance"), (req, res) => {',
    'app.post("/api/assignments/:id/handoff-governance/evaluate", requireRole("admin", "user", "freelance"), (req, res) => {',
  ];
  for (const snippet of forbiddenServerSnippets) {
    assert.equal(indexServer.includes(snippet), false, `review-like assignment API should not allow freelance snippet: ${snippet}`);
  }
});

test("assignment UI no longer treats close_assignment or closed as a separate user-facing step", () => {
  const forbiddenAppSnippets = [
    'Object.freeze({ value: "close_assignment", label: "ปิดงาน" })',
    'งานนี้ปิดแล้วและปิดในระบบแล้ว',
    'งานนี้ปิดแล้ว',
  ];
  for (const snippet of forbiddenAppSnippets) {
    assert.equal(appJs.includes(snippet), false, `assignment UI should not expose legacy close-step snippet: ${snippet}`);
  }

  const requiredAppSnippets = [
    'stateHelp: "งานนี้เสร็จแล้วหลังการตรวจรับผ่าน"',
    'nextBody: "งานนี้เสร็จแล้วหลังการตรวจรับผ่าน"',
    'stateValue === "accepted" || stateValue === "closed"',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment UI should keep completed-state snippet: ${snippet}`);
  }

  const requiredIndexSnippets = [
    'id="assignment-panel-title"',
    'id="assignment-panel-note"',
    'ใช้ส่วนนี้สำหรับรับงาน เริ่มลงหน้างาน และอัปเดตสถานะตามความคืบหน้าปัจจุบัน',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `assignment UI should keep updated wording snippet: ${snippet}`);
  }
});

test("collapsed assignment workspaces keep short summaries instead of only titles", () => {
  const requiredIndexSnippets = [
    'id="assignment-state-workspace-summary"',
    'id="assignment-submission-workspace-summary"',
    'id="assignment-review-workspace-summary"',
  ];
  for (const snippet of requiredIndexSnippets) {
    assert.equal(indexHtml.includes(snippet), true, `assignment workflow layout should keep collapsed summary node: ${snippet}`);
  }

  const requiredAppSnippets = [
    "function buildAssignmentWorkspaceSummaries(assignment)",
    'summaryNode.textContent = summaryText || "เลือกงานในกระบวนการนี้เพื่อดูสรุปของขั้นนี้";',
    'summaryNode.classList.toggle("hidden", normalizedMode !== "collapsed");',
    "deliverableCount > 0",
    'stateValue === "submitted" || stateValue === "resubmitted"',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment workflow layout should build collapsed summary snippet: ${snippet}`);
  }

  const requiredStyleSnippets = [
    ".assignment-workspace-summary {",
    ".assignment-workspace-section.is-collapsed .assignment-workspace-summary {",
  ];
  for (const snippet of requiredStyleSnippets) {
    assert.equal(stylesCss.includes(snippet), true, `assignment workflow layout should style collapsed summary snippet: ${snippet}`);
  }
});

test("assignment workspace summary uses a local updated-at formatter instead of missing formatDateTime helper", () => {
  const requiredAppSnippets = [
    "function formatAssignmentWorkspaceUpdatedAt(value)",
    'formatAssignmentWorkspaceUpdatedAt(assignment.updated_at)',
    'return date.toLocaleString("sv-SE", {',
    'timeZone: "Asia/Bangkok",',
  ];
  for (const snippet of requiredAppSnippets) {
    assert.equal(appJs.includes(snippet), true, `assignment workspace summary should keep formatter snippet: ${snippet}`);
  }

  assert.equal(
    appJs.includes("formatDateTime(assignment.updated_at)"),
    false,
    "assignment workspace summary should not call missing formatDateTime helper"
  );
});

