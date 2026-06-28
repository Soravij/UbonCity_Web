const ASSIGNMENT_ACTION_VALUES = new Set([
  "request_revision",
  "accept_submission",
  "reopen_in_progress",
  "close_assignment",
]);

const ASSIGNMENT_PROCESS_GUIDE = Object.freeze({
  assigned: Object.freeze({
    step: 2,
    nextAction: "ขั้นถัดไป: เริ่มลงงานตามคำสั่งงานในขั้นที่ 2",
  }),
  in_progress: Object.freeze({
    step: 2,
    nextAction: "ขั้นถัดไป: เมื่อจบหน้างาน ให้ส่งข้อมูลกลับมาเพื่อตรวจงานในขั้นที่ 3",
  }),
  submitted: Object.freeze({
    step: 3,
    nextAction: "ขั้นถัดไป: ตรวจงานที่ส่งกลับมาในขั้นที่ 3",
  }),
  resubmitted: Object.freeze({
    step: 3,
    nextAction: "ขั้นถัดไป: กลับไปตรวจงานในขั้นที่ 3",
  }),
  revision_requested: Object.freeze({
    step: 2,
    nextAction: "ผลตรวจยังไม่ผ่าน: กลับไปลงงานและส่งกลับมาอีกครั้งในขั้นที่ 2",
  }),
  accepted: Object.freeze({
    step: 3,
    nextAction: "งานนี้เสร็จแล้วหลังการตรวจรับผ่าน",
  }),
  closed: Object.freeze({
    step: 3,
    nextAction: "งานนี้เสร็จแล้ว",
  }),
});

const ASSIGNMENT_PROCESS_DEFAULT = Object.freeze({
  step: 1,
  nextAction: "ยังไม่มีงานที่เลือก",
});

const ASSIGNMENT_UI_STATE_CONFIG = Object.freeze({
  assigned: Object.freeze({
    stateActions: [
      Object.freeze({ value: "reopen_in_progress", label: "เริ่มทำงาน" }),
    ],
    stateHelp: "งานถูกส่งออกไปแล้ว ขั้นถัดไปคือเริ่มลงงานในกระบวนการ 2",
    stateButtonLabel: "เริ่มงาน / อัปเดตสถานะ",
    submissionActions: [
      Object.freeze({ value: "submit", label: "ส่งผลงาน" }),
    ],
    submissionHelp: "ถ้ามีข้อมูลจากหน้างานพร้อมแล้ว สามารถส่งงานกลับได้ทันที",
    submissionButtonLabel: "ส่งงานกลับ",
  }),
  in_progress: Object.freeze({
    stateActions: [],
    stateHelp: "งานอยู่ระหว่างลงงาน โดยปกติขั้นถัดไปคือส่งข้อมูลกลับมาเพื่อตรวจงาน",
    stateButtonLabel: "อัปเดตสถานะงาน",
    submissionActions: [
      Object.freeze({ value: "submit", label: "ส่งผลงาน" }),
    ],
    submissionHelp: "เมื่อจบหน้างาน ให้ส่งข้อมูลกลับและแนบรูปหรือวิดีโอในขั้นนี้",
    submissionButtonLabel: "ส่งงานกลับ",
  }),
  submitted: Object.freeze({
    stateActions: [],
    stateHelp: "งานถูกส่งกลับมาแล้ว ให้ตรวจงานในขั้นที่ 3",
    stateButtonLabel: "อัปเดตสถานะงาน",
    submissionActions: [],
    submissionHelp: "รอตรวจงานจากผู้ดูแลงานก่อน จึงยังไม่ควรส่งงานเพิ่มในขั้นนี้",
    submissionButtonLabel: "ส่งงานกลับ",
  }),
  revision_requested: Object.freeze({
    stateActions: [],
    stateHelp: "งานนี้ถูกขอแก้เพิ่มแล้ว ให้แก้ตามหมายเหตุแล้วส่งงานกลับอีกครั้ง",
    stateButtonLabel: "อัปเดตสถานะงาน",
    submissionActions: [
      Object.freeze({ value: "resubmit", label: "ส่งงานกลับ" }),
    ],
    submissionHelp: "งานนี้เป็นรอบแก้ ให้แก้ตามหมายเหตุแล้วส่งงานกลับในขั้นลงงาน",
    submissionButtonLabel: "ส่งงานกลับ",
  }),
  resubmitted: Object.freeze({
    stateActions: [],
    stateHelp: "งานที่ขอแก้ถูกส่งกลับมาแล้ว ให้ตรวจงานในขั้นที่ 3",
    stateButtonLabel: "อัปเดตสถานะงาน",
    submissionActions: [],
    submissionHelp: "รอตรวจงานจากผู้ดูแลงานก่อน จึงยังไม่ควรส่งงานเพิ่มในขั้นนี้",
    submissionButtonLabel: "ส่งงานกลับ",
  }),
  accepted: Object.freeze({
    stateActions: [],
    stateHelp: "งานนี้เสร็จแล้วหลังการตรวจรับผ่าน",
    stateButtonLabel: "งานนี้เสร็จแล้ว",
    submissionActions: [],
    submissionHelp: "งานผ่านแล้ว ไม่ควรส่ง submission เพิ่มในขั้นนี้",
    submissionButtonLabel: "ส่งงานกลับ",
  }),
  closed: Object.freeze({
    stateActions: [],
    stateHelp: "งานนี้เสร็จแล้ว",
    stateButtonLabel: "งานนี้เสร็จแล้ว",
    submissionActions: [],
    submissionHelp: "งานนี้เสร็จแล้ว ไม่ควรส่ง submission เพิ่มในขั้นนี้",
    submissionButtonLabel: "ส่งงานกลับ",
  }),
});

const ASSIGNMENT_UI_ACTION_TO_STATE = Object.freeze({
  request_revision: "revision_requested",
  accept_submission: "accepted",
  reopen_in_progress: "in_progress",
  close_assignment: "closed",
});

const ASSIGNMENT_DELIVERABLE_OPTIONS = Object.freeze([
  Object.freeze({ value: "photos", label: "ภาพถ่าย" }),
  Object.freeze({ value: "videos", label: "วิดีโอ" }),
  Object.freeze({ value: "raw_notes", label: "บันทึกหน้างาน" }),
  Object.freeze({ value: "caption_draft", label: "ร่างแคปชัน" }),
  Object.freeze({ value: "script_draft", label: "ร่างสคริปต์" }),
  Object.freeze({ value: "article_draft", label: "ร่างบทความ" }),
]);

const CONTENT_CATEGORY_OPTIONS = Object.freeze([
  Object.freeze({ value: "attractions", label: "ที่เที่ยว" }),
  Object.freeze({ value: "activities", label: "กิจกรรม" }),
  Object.freeze({ value: "hotels", label: "ที่พัก" }),
  Object.freeze({ value: "cafes", label: "คาเฟ่" }),
  Object.freeze({ value: "restaurants", label: "ร้านอาหาร" }),
  Object.freeze({ value: "transport", label: "การเดินทาง" }),
]);

const REFERENCE_CLEANUP_CANDIDATE_KEYS = new Set([
  "source_records",
  "content_assets",
  "reviews_raw",
  "drafts",
  "quality_checks",
  "review_reports",
  "staging_items",
  "content_versions",
  "evidence_blocks",
  "approved_context_blocks",
  "draft_input_snapshots",
  "field_packs",
  "content_workflow_models",
  "content_workflow_transitions",
  "content_readiness_briefs",
  "content_execution_controls",
  "content_execution_channels",
  "search_enrichment_records",
  "place_intelligence_scores",
  "social_signal_sources",
  "social_momentum_snapshots",
  "content_direction_reports",
  "content_intelligence_models",
  "internal_link_sources",
  "internal_link_targets",
]);

const state = {
  token: sessionStorage.getItem("collector_token") || localStorage.getItem("collector_token") || "",
  loginAt: sessionStorage.getItem("collector_login_at") || localStorage.getItem("collector_login_at") || "",
  user: null,
  visibleUsers: [],
  freelanceUsers: [],
  agentProfiles: [],
  selectedAgentProfileKey: "field_pack_agent",
  agentProfilePanelOpen: false,
  aiPolicyPanelOpen: false,
  aiPolicyRows: [],
  aiPolicyCatalog: [],
  aiPolicyLoaded: false,
  aiPolicyError: "",
  dataCleanupPanelOpen: false,
  referenceCleanupPanelOpen: false,
  referenceCleanupDeletedItems: [],
  referenceCleanupSelectedItemId: 0,
  referenceCleanupReferences: null,
  referenceCleanupSelectedGroups: new Set(),
  cleanup: {
    rows: [],
    loaded: false,
    lastError: "",
  },
  justExportedItemId: Number(new URLSearchParams(window.location.search).get("item_id") || 0),
  preferredTab: String(new URLSearchParams(window.location.search).get("tab") || "").trim().toLowerCase(),
  items: [],
  dashboard: {
    rawShowAll: true,
    rawLimit: 8,
    rawTableCollapsed: false,
    rawIntakeCollapsed: false,
    rawReviewCollapsed: false,
    rawSort: "interestingness",
    rawStageFilter: "all",
    rawIntakeFilter: "all",
    rawReviewFilter: "all",
    rawSelectedIds: new Set(),
    rawMergeOpen: false,
    rawMergeMasterId: 0,
  },
  assignments: {
    rows: [],
    managedRows: [],
    submittedRows: [],
    selectedId: null,
    trackOnlySelectionId: null,
    submittedSelectionId: null,
    expectedDeliverablesTouched: false,
    deliverablesBundle: null,
    submissionDrafts: {},
    latestSubmissionArticlePayloads: {},
    latestSubmissionRows: {},
    latestSubmissionLoaded: {},
    serverSubmissionDraftPayloads: {},
    serverSubmissionDraftLoaded: {},
    serverSubmissionDraftSaveTimers: {},
    handoffSourcePackages: {},
    handoffSourceSnapshotIds: {},
    handoffSourceLoaded: {},
    requestedCheckReturnDrafts: {},
    requestedCheckReturnDraftDirty: {},
    requestedCheckReturnDraftSources: {},
    latestUploadedAssets: [],
    latestUploadedAssetsKey: "",
    syncedUploadAssetsByKey: {},
    reviewSelectedVideoKey: "",
    workLatestComment: "",
    workLatestCommentLoaded: false,
    workLatestCommentLoading: false,
    assets: [],
    assetLookup: [],
    landingItemId: Number(new URLSearchParams(window.location.search).get("item_id") || 0),
    landingAssignmentId: Number(new URLSearchParams(window.location.search).get("assignment_id") || 0),
    itemLandingApplied: false,
    assignmentLandingApplied: false,
    contextItemId: Number(new URLSearchParams(window.location.search).get("item_id") || 0),
    contextFieldPackStatus: "",
    contextFieldPack: null,
    contextFieldPackLoadFailed: false,
    captureUploadDrafts: {},
    captureUploadLoading: {},
    captureUploadSyncState: {},
  },
  sourceIntake: {
    open: false,
    batchUid: "",
    adapter: "",
    sourceLabel: "",
    query: "",
    selectedMode: "new",
    selectedExistingItemId: 0,
    candidates: [],
  },
};

const AUTH_RETURN_TO_KEY = "collector_return_to";

function qs(id) {
  return document.getElementById(id);
}

function sanitizeRelativeReturnTo(value) {
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "";
  return raw;
}

function getCurrentReturnToPath() {
  return sanitizeRelativeReturnTo(`${window.location.pathname || "/"}${window.location.search || ""}`);
}

function persistAuthReturnTo(target = getCurrentReturnToPath()) {
  const safeTarget = sanitizeRelativeReturnTo(target);
  if (!safeTarget) return;
  try {
    sessionStorage.setItem(AUTH_RETURN_TO_KEY, safeTarget);
  } catch {
    // ignore storage failures
  }
}

function consumeAuthReturnTo() {
  const params = new URLSearchParams(window.location.search);
  const queryTarget = sanitizeRelativeReturnTo(params.get("return_to") || "");
  let storedTarget = "";
  try {
    storedTarget = sanitizeRelativeReturnTo(sessionStorage.getItem(AUTH_RETURN_TO_KEY) || "");
    sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
  } catch {
    storedTarget = "";
  }
  return queryTarget || storedTarget || "";
}

function hasExplicitReturnToQuery() {
  const params = new URLSearchParams(window.location.search);
  return Boolean(sanitizeRelativeReturnTo(params.get("return_to") || ""));
}

function redirectToLoginWithReturnTo(target = getCurrentReturnToPath()) {
  const safeTarget = sanitizeRelativeReturnTo(target);
  if (safeTarget) persistAuthReturnTo(safeTarget);
  const params = new URLSearchParams();
  if (safeTarget) params.set("return_to", safeTarget);
  const query = params.toString();
  window.location.assign(`/${query ? `?${query}` : ""}`);
}

function redirectToLoginWithExpiredSession(target = getCurrentReturnToPath()) {
  const safeTarget = sanitizeRelativeReturnTo(target);
  if (safeTarget) persistAuthReturnTo(safeTarget);
  const params = new URLSearchParams();
  params.set("auth", "expired");
  if (safeTarget) params.set("return_to", safeTarget);
  const query = params.toString();
  window.location.replace(`/${query ? `?${query}` : ""}`);
}

function applyAuthLandingNotice() {
  const params = new URLSearchParams(window.location.search);
  const authState = String(params.get("auth") || "").trim().toLowerCase();
  if (authState !== "expired") return;
  setStatus("auth-status", "เซสชันหมดอายุหรือ token ใช้ไม่ได้ กรุณาเข้าสู่ระบบใหม่", true);
  qs("auth-email")?.focus();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function prettyJson(value) {
  if (value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

function setJsonPreview(id, value) {
  const node = qs(id);
  if (!node) return;
  node.textContent = prettyJson(value);
}

function currentRole() {
  return String(state.user?.role || "").toLowerCase();
}

function isFreelanceUser() {
  return currentRole() === "freelance";
}

function isAdminUser() {
  const role = currentRole();
  return role === "admin" || role === "owner";
}

function isOwnerUser() {
  return currentRole() === "owner";
}

function isOwnerReviewTrackingEnabled() {
  return isOwnerUser() && Boolean(qs("assignment-review-tracking")?.checked);
}

function isAssignmentWorkOnlyUser() {
  const role = currentRole();
  return role === "freelance";
}

function isAssignmentWorkOnlyRole(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return normalizedRole === "freelance";
}

function canSeeAssignmentBaseTasksSurface(role = currentRole()) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return Boolean(normalizedRole);
}

function canSeeAssignmentCurrentWorkSurface(role = currentRole()) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return Boolean(normalizedRole);
}

function canSeeAssignmentExtendedManageSurface(role = currentRole()) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "user";
}

function canSeeAssignmentExtendedReviewSurface(role = currentRole()) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "user";
}

function applyFreelanceWorkerView(pageMode = getAssignmentPageMode()) {
  if (currentRole() !== "freelance") return;
  const titleNode = qs("assignment-panel-title");
  const noteNode = qs("assignment-panel-note");
  const pageSummary = qs("assignment-page-summary");
  const guideBox = qs("assignment-next-action")?.closest(".assignment-guide") || null;
  const stepsRoot = qs("assignment-process-steps");
  const stateWorkspaceTitle = qs("assignment-state-workspace-title");
  const stateWorkspaceHelp = qs("assignment-state-workspace-help");
  const submissionTitle = qs("assignment-submission-workspace-title");
  const submissionHelp = qs("assignment-submission-workspace-help");
  const reviewTitle = qs("assignment-review-workspace-title");
  const reviewHelp = qs("assignment-review-workspace-help");
  const actionListTitle = qs("assignment-actionable-list-title");
  const actionListNote = qs("assignment-actionable-list-note");
  const submittedListTitle = qs("assignment-submitted-list-title");
  const submittedListNote = qs("assignment-submitted-list-note");
  const loadAssignmentsBtn = qs("btn-assignments-load");

  if (titleNode) titleNode.textContent = "งานของฉัน";
  if (noteNode) noteNode.textContent = "เปิดงานที่ได้รับมอบหมาย กรอกข้อมูล แนบไฟล์ และส่งกลับจากหน้านี้";
  if (pageSummary) pageSummary.classList.add("hidden");
  if (guideBox) guideBox.classList.add("hidden");
  if (stepsRoot) stepsRoot.classList.add("hidden");
  if (stateWorkspaceTitle) stateWorkspaceTitle.textContent = "สถานะงาน";
  if (stateWorkspaceHelp) stateWorkspaceHelp.textContent = "ใช้ส่วนนี้เพื่ออัปเดตสถานะงานของคุณเมื่อจำเป็น";
  if (submissionTitle) submissionTitle.textContent = "แบบส่งงาน";
  if (submissionHelp) submissionHelp.textContent = "กรอกข้อมูล แนบไฟล์ และส่งงานกลับจากหน้านี้";
  if (reviewTitle) reviewTitle.textContent = "สถานะล่าสุด";
  if (reviewHelp) reviewHelp.textContent = "ดูสรุปล่าสุดของงานที่คุณส่งแล้วจากส่วนนี้";
  if (actionListTitle) actionListTitle.textContent = "งานที่ต้องทำ";
  if (actionListNote) actionListNote.textContent = "รายการนี้แสดงเฉพาะงานที่คุณต้องลงมือทำตอนนี้";
  if (submittedListTitle) submittedListTitle.textContent = "งานที่ส่งแล้ว";
  if (submittedListNote) submittedListNote.textContent = "รายการนี้แสดงงานที่คุณส่งกลับแล้วและกำลังรอผลตรวจ";
  if (loadAssignmentsBtn) loadAssignmentsBtn.textContent = "โหลดงานของฉัน";
}

function isEditorUser() {
  return currentRole() === "editor";
}

function canSeeManagedAssignmentsTable() {
  return canSeeAssignmentExtendedManageSurface(currentRole());
}

function getDefaultLandingTabForRole(role = currentRole()) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (!normalizedRole) return "home";
  if (normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "user") return "home";
  if (normalizedRole === "editor") return "assignments";
  return isAssignmentWorkOnlyRole(normalizedRole) ? "work" : "handoff";
}

function canAccessPreferredTabForRole(rawTabValue, role = currentRole()) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const normalizedTab = String(rawTabValue || "").trim().toLowerCase();
  if (!normalizedRole) return normalizedTab || "home";
  if (normalizedRole === "editor" && ["assignments", "handoff", "work", "review"].includes(normalizedTab)) {
    return "assignments";
  }
  if (normalizedTab === "home") {
    return normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "user"
      ? "home"
      : getDefaultLandingTabForRole(normalizedRole);
  }
  if (["assignments", "handoff", "work", "review"].includes(normalizedTab)) {
    if (isAssignmentWorkOnlyRole(normalizedRole) && (normalizedTab === "handoff" || normalizedTab === "review")) {
      return "work";
    }
    return normalizedTab === "assignments" ? getDefaultLandingTabForRole(normalizedRole) : normalizedTab;
  }
  if (normalizedTab === "users") {
    return canAccessContributorManagementSurface(normalizedRole)
      ? "users"
      : getDefaultLandingTabForRole(normalizedRole);
  }
  if (normalizedTab === "events") {
    return canAccessInternalStaffWorkspaces(normalizedRole)
      ? "events"
      : getDefaultLandingTabForRole(normalizedRole);
  }
  if (normalizedTab === "place") {
    return canAccessInternalStaffWorkspaces(normalizedRole)
      ? "place"
      : getDefaultLandingTabForRole(normalizedRole);
  }
  if (["transport", "transport-map", "other-transport"].includes(normalizedTab)) {
    return getDefaultLandingTabForRole(normalizedRole);
  }
  if (normalizedTab === "raw") {
    return canAccessInternalStaffWorkspaces(normalizedRole)
      ? normalizedTab
      : getDefaultLandingTabForRole(normalizedRole);
  }
  return getDefaultLandingTabForRole(normalizedRole);
}

function getDefaultAssignmentPageMode() {
  if (currentRole() === "editor") return "work";
  return getDefaultLandingTabForRole(currentRole());
}

function resolvePreferredTab(rawTabValue, currentPreferredTab = state.preferredTab) {
  const normalizedTab = String(rawTabValue || "").trim().toLowerCase();
  if (normalizedTab !== "assignments") return canAccessPreferredTabForRole(normalizedTab, currentRole());
  if (currentRole() === "editor") return "assignments";
  const currentMode = String(currentPreferredTab || "").trim().toLowerCase();
  const nextMode = ["handoff", "work", "review"].includes(currentMode)
    ? currentMode
    : getDefaultAssignmentPageMode();
  return canAccessPreferredTabForRole(nextMode, currentRole());
}

function getRequestedTabFromUrl() {
  return String(new URLSearchParams(window.location.search).get("tab") || "").trim().toLowerCase();
}

function isDebugUiEnabled() {
  return String(new URLSearchParams(window.location.search).get("debug_ui") || "").trim() === "1";
}

function renderLandingDebugState(reason = "", extras = {}) {
  if (!isDebugUiEnabled()) return;
  const host = qs("app-shell") || document.body;
  if (!host) return;
  let node = qs("landing-debug-state");
  if (!node) {
    node = document.createElement("pre");
    node.id = "landing-debug-state";
    node.className = "muted";
    node.style.marginTop = "8px";
    node.style.whiteSpace = "pre-wrap";
    host.prepend(node);
  }
  const panel = document.querySelector(".panel.active");
  const activeTopTabId = getPreferredTopTabId() || "(none)";
  const debugPayload = {
    reason,
    requested_tab: getRequestedTabFromUrl(),
    preferred_tab: state.preferredTab,
    resolved_top_tab: activeTopTabId,
    active_panel_id: panel?.id || "(none)",
    role: currentRole() || "(none)",
    auth_source: String(state.user?.auth_source || "").trim() || "(none)",
    ...extras,
  };
  node.textContent = `landing-debug:\n${JSON.stringify(debugPayload, null, 2)}`;
}

function resolvePreferredTopTabNode(preferredTab = state.preferredTab) {
  const normalizedPreferredTab = String(preferredTab || "").trim().toLowerCase();
  const topTabId = normalizedPreferredTab === "home"
    ? ""
    : normalizedPreferredTab === "users"
      ? "tab-users"
      : ["handoff", "work", "review", "assignments"].includes(normalizedPreferredTab)
        ? "tab-assignments"
        : `tab-${normalizedPreferredTab}`;
  return topTabId ? qs(topTabId) : null;
}

function editorWorkspaceUrl(itemId) {
  const normalizedItemId = parsePositiveInt(itemId, 0);
  return normalizedItemId > 0 ? `/article-workspace.html?id=${normalizedItemId}` : "/article-workspace.html";
}

function editorEventWorkspaceUrl(itemId) {
  const normalizedItemId = parsePositiveInt(itemId, 0);
  return normalizedItemId > 0 ? `/event-workspace.html?id=${normalizedItemId}` : "/event-workspace.html";
}

function editorSubmitUrl(itemId) {
  const normalizedItemId = parsePositiveInt(itemId, 0);
  return normalizedItemId > 0 ? `/article-submit.html?id=${normalizedItemId}` : "/article-submit.html";
}

function editorEventSubmitUrl(itemId) {
  const normalizedItemId = parsePositiveInt(itemId, 0);
  return normalizedItemId > 0 ? `/event-submit.html?id=${normalizedItemId}` : "/event-submit.html";
}

function transportMapWorkspaceUrl(itemId) {
  const normalizedItemId = parsePositiveInt(itemId, 0);
  return normalizedItemId > 0 ? `/transport-map-workspace.html?id=${normalizedItemId}` : "";
}

function transportMapReviewUrl(itemId) {
  const normalizedItemId = parsePositiveInt(itemId, 0);
  return normalizedItemId > 0 ? `/transport-map-review.html?id=${normalizedItemId}` : "";
}

function editorIntakeUrl(itemId = 0) {
  const normalizedItemId = parsePositiveInt(itemId, 0);
  return normalizedItemId > 0 ? editorWorkspaceUrl(normalizedItemId) : "/";
}

function editorPortalUrl(itemId = 0) {
  const normalizedItemId = parsePositiveInt(itemId, 0);
  return normalizedItemId > 0 ? `/editor-home.html?item_id=${normalizedItemId}` : "/editor-home.html";
}

function freelancePortalUrl(itemId = 0, assignmentId = 0) {
  const params = new URLSearchParams();
  const normalizedItemId = parsePositiveInt(itemId, 0);
  const normalizedAssignmentId = parsePositiveInt(assignmentId, 0);
  if (normalizedItemId > 0) params.set("item_id", String(normalizedItemId));
  if (normalizedAssignmentId > 0) params.set("assignment_id", String(normalizedAssignmentId));
  const query = params.toString();
  return query ? `/freelance-home.html?${query}` : "/freelance-home.html";
}

function rolePortalTarget(role = currentRole(), itemId = 0, assignmentId = 0) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "editor") return editorPortalUrl(itemId);
  if (normalizedRole === "freelance") return freelancePortalUrl(itemId, assignmentId);
  return "";
}

function normalizeRoleReturnTo(role = currentRole(), returnTo = "") {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const rawReturnTo = String(returnTo || "").trim();
  if (!rawReturnTo || (normalizedRole !== "editor" && normalizedRole !== "freelance")) return rawReturnTo;
  let pathname = "";
  try {
    pathname = String(new URL(rawReturnTo, window.location.origin).pathname || "").trim().toLowerCase();
  } catch {
    pathname = "";
  }
  if (!pathname) return "";
  if (normalizedRole === "editor") {
    if (pathname === "/article-workspace.html" || pathname === "/event-workspace.html" || pathname === "/editor-home.html") {
      return rawReturnTo;
    }
    return "";
  }
  if (pathname === "/" || pathname === "/freelance-home.html") return rawReturnTo;
  return "";
}

function normalizeContentType(value) {
  return String(value || "").trim().toLowerCase();
}

function findLoadedItemById(itemId) {
  const normalizedItemId = parsePositiveInt(itemId, 0);
  if (!normalizedItemId) return null;
  return (Array.isArray(state.items) ? state.items : []).find((item) => Number(item?.id || 0) === normalizedItemId) || null;
}

function getAssignmentContentItemMeta(assignment) {
  const itemId = parsePositiveInt(assignment?.content_item_id, 0);
  const item = itemId ? findLoadedItemById(itemId) : null;
  return {
    itemId: itemId || 0,
    title: String(item?.title || "").trim() || "-",
  };
}

function getAssignmentContextItem() {
  const itemId = Number(state.assignments.contextItemId || getAssignmentLandingItemId() || 0) || 0;
  return itemId > 0 ? findLoadedItemById(itemId) : null;
}

function isTransportMapContentItem(item) {
  return normalizeContentType(item?.type) === "public_transport_map";
}

function getItemWorkflowSnapshot(item) {
  const productionState = String(item?.production_state || "").trim().toLowerCase();
  const publicationState = String(item?.publication_state || "").trim().toLowerCase();
  const assignmentState = String(item?.assignment_state || "").trim().toLowerCase();
  let compatibilityStatus = "";
  if (publicationState === "published") compatibilityStatus = "published";
  else if (publicationState === "approved" || publicationState === "unpublished" || productionState === "ready_for_publish") compatibilityStatus = "approved";
  else if (productionState === "in_review") compatibilityStatus = "in_review";
  else if (productionState === "needs_revision") compatibilityStatus = "needs_revision";
  else if (productionState === "rejected") compatibilityStatus = "rejected";
  else if (productionState === "content_in_progress") compatibilityStatus = "content_in_progress";
  else if (productionState === "generated") compatibilityStatus = "generated";
  else if (productionState === "ready_for_content") compatibilityStatus = "ready_for_content";
  else if (productionState === "brief_generated") compatibilityStatus = "brief_generated";
  else if (productionState === "analyzed") compatibilityStatus = "analyzed";
  else if (productionState === "collected") compatibilityStatus = "raw";
  else compatibilityStatus = "raw";
  return {
    productionState,
    publicationState,
    assignmentState,
    compatibilityStatus,
  };
}

function resolveQueueBucket(itemSnapshot) {
  const source = itemSnapshot && typeof itemSnapshot === "object" ? itemSnapshot : {};
  const snapshot = source && Object.prototype.hasOwnProperty.call(source, "productionState")
    ? itemSnapshot
    : getItemWorkflowSnapshot(itemSnapshot);
  const productionState = String(snapshot?.productionState || "").trim().toLowerCase();
  const publicationState = String(snapshot?.publicationState || "").trim().toLowerCase();
  const assignmentState = String(snapshot?.assignmentState || "").trim().toLowerCase();
  const fieldPackStatus = String(source?.current_field_pack_status || source?.field_pack_status || snapshot?.current_field_pack_status || snapshot?.field_pack_status || "").trim().toLowerCase();
  const hasFieldPackPointer = Number(source?.current_field_pack_id || source?.field_pack_id || snapshot?.current_field_pack_id || snapshot?.field_pack_id || 0) > 0;
  const hasFieldPack = hasFieldPackPointer || Boolean(fieldPackStatus);

  if (publicationState === "published" || productionState === "completed") {
    return "published";
  }
  if (assignmentState) {
    return "assignment";
  }
  if (
    publicationState === "approved"
    || publicationState === "unpublished"
    || productionState === "ready_for_publish"
    || productionState === "in_review"
    || productionState === "needs_revision"
    || productionState === "content_in_progress"
    || productionState === "submitted_for_admin_review"
  ) {
    return "published";
  }
  if (hasFieldPack && isAssignmentContextReady(fieldPackStatus)) {
    return "handoff";
  }
  if (hasFieldPack) {
    return "field_pack_review";
  }
  return "raw_prep";
}

function isRawPreparationItem(item) {
  return resolveQueueBucket(item) === "raw_prep"
    && getItemWorkflowSnapshot(item).productionState === "collected";
}

function getEditorialSurfaceUrlForItem(item, preferredStatus = "") {
  const normalizedItemId = parsePositiveInt(item?.id, 0);
  if (!normalizedItemId) return "";
  const status = String(preferredStatus || getItemWorkflowSnapshot(item).compatibilityStatus || "").trim().toLowerCase();
  const bucket = resolveQueueBucket(item);
  const isReviewStage = status === "in_review"
    || status === "approved"
    || status === "published"
    || status === "unpublished"
    || status === "ready_for_review"
    || status === "ready_for_sync"
    || status === "synced_to_admin"
    || status === "submitted_for_admin_review"
    || bucket === "published";

  if (isTransportMapContentItem(item)) {
    if (isReviewStage) {
      return transportMapReviewUrl(normalizedItemId);
    }
    return transportMapWorkspaceUrl(normalizedItemId);
  }

  const isEvent = String(item?.type || "").trim().toLowerCase() === "event";
  const workspaceUrl = isEvent
    ? editorEventWorkspaceUrl(normalizedItemId)
    : editorWorkspaceUrl(normalizedItemId);
  const reviewUrl = isEvent
    ? editorEventSubmitUrl(normalizedItemId)
    : editorSubmitUrl(normalizedItemId);

  if (isEditorUser()) {
    return workspaceUrl;
  }
  if (isReviewStage) {
    return reviewUrl;
  }
  return workspaceUrl;
}

async function resolveEditorialSurfaceUrlByItemId(itemId, fallbackUrl = "") {
  const normalizedItemId = parsePositiveInt(itemId, 0);
  if (!normalizedItemId) return fallbackUrl;
  try {
    const [item, processPayload] = await Promise.all([
      api(`/api/items/${normalizedItemId}`),
      api(`/api/items/${normalizedItemId}/article-process`).catch(() => null),
    ]);
    const processStatus = String(processPayload?.current_status || "").trim().toLowerCase();
    return getEditorialSurfaceUrlForItem(item, processStatus || getItemWorkflowSnapshot(item).compatibilityStatus);
  } catch {
    const localItem = findLoadedItemById(normalizedItemId);
    if (localItem) {
      return getEditorialSurfaceUrlForItem(localItem, getItemWorkflowSnapshot(localItem).compatibilityStatus);
    }
    return fallbackUrl;
  }
}

async function resolveEditorLandingUrl() {
  const landingItemId = parsePositiveInt(state.assignments?.landingItemId, 0);
  if (landingItemId > 0) {
    return resolveEditorialSurfaceUrlByItemId(landingItemId, editorIntakeUrl(landingItemId));
  }
  try {
    const selfId = parsePositiveInt(state.user?.id, 0);
    const path = selfId
      ? `/api/assignments/mine?assignee_user_id=${selfId}&limit=50`
      : "/api/assignments/mine?limit=50";
    const response = await api(path);
    const rows = Array.isArray(response?.assignments) ? response.assignments : [];
    const editorialAssignments = rows.filter((row) => {
      const contentItemId = parsePositiveInt(row?.content_item_id, 0);
      return contentItemId > 0 && getAssignmentSubmissionKind(row) === "editorial";
    });
    const stateRank = new Map([
      ["in_progress", 4],
      ["revision_requested", 3],
      ["assigned", 2],
      ["submitted", 1],
    ]);
    editorialAssignments.sort((left, right) => {
      const leftRank = stateRank.get(String(left?.state || "").trim().toLowerCase()) || 0;
      const rightRank = stateRank.get(String(right?.state || "").trim().toLowerCase()) || 0;
      if (rightRank !== leftRank) return rightRank - leftRank;
      return (Number(right?.updated_at_unix || 0) || 0) - (Number(left?.updated_at_unix || 0) || 0);
    });
    const editorialAssignment = editorialAssignments[0] || null;
    const contentItemId = parsePositiveInt(editorialAssignment?.content_item_id, 0);
    return resolveEditorialSurfaceUrlByItemId(contentItemId, editorIntakeUrl(contentItemId));
  } catch {
    return editorIntakeUrl();
  }
}

async function maybeApplyEditorLanding(returnTo = "") {
  if (currentRole() !== "editor") return false;
  if (returnTo) return false;
  if (String(window.location.pathname || "/") !== "/") return false;
  const params = new URLSearchParams(window.location.search);
  const requestedItemId = parsePositiveInt(params.get("item_id"), 0);
  if (requestedItemId > 0) {
    const targetUrl = await resolveEditorialSurfaceUrlByItemId(requestedItemId, editorIntakeUrl(requestedItemId));
    if (targetUrl) {
      window.location.assign(targetUrl);
      return true;
    }
  }
  const intakeTarget = await resolveEditorLandingUrl();
  if (intakeTarget) {
    window.location.assign(intakeTarget);
    return true;
  }
  return false;
}

function getPreferredTopTabId() {
  return resolvePreferredTopTabNode()?.id || "";
}

function canAccessUserManagement() {
  const role = currentRole();
  return role === "owner" || role === "admin" || role === "user";
}

function canAccessInternalStaffWorkspaces(role = currentRole()) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "user";
}

function canAccessContributorManagementSurface(role = currentRole()) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return normalizedRole === "owner" || normalizedRole === "admin" || normalizedRole === "user";
}

function canAccessSystemPage() {
  return isOwnerUser();
}

function isStandardUser() {
  return currentRole() === "user";
}

function canManageFreelanceAssignments() {
  const role = currentRole();
  return role === "owner" || role === "admin" || role === "user";
}

function isAssignmentContextReady(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "ready_for_field" || normalized === "ready_for_handoff";
}

function isHandoffEligibleItem(item) {
  if (!item || typeof item !== "object") return false;
  return resolveQueueBucket(item) === "handoff";
}

function hasAssignmentBriefPrepared(fieldPack) {
  return Boolean(fieldPack && Number(fieldPack.id || 0) > 0);
}

function getAssignmentPrepStepState(fieldPackStatus, fieldPack) {
  const briefPrepared = hasAssignmentBriefPrepared(fieldPack);
  const readyForAssignment = briefPrepared && isAssignmentContextReady(fieldPackStatus);
  return {
    briefPrepared,
    readyForAssignment,
  };
}

function canManageBulkContentItems() {
  return isAdminUser();
}

function canPatchAssignmentState() {
  const role = currentRole();
  return role === "owner" || role === "admin" || role === "user";
}

function getAssignmentPageMode() {
  const tabValue = String(state.preferredTab || "").trim().toLowerCase();
  if (tabValue === "assignments") {
    return getDefaultAssignmentPageMode();
  }
  if ((tabValue === "handoff" || tabValue === "review") && isAssignmentWorkOnlyUser()) {
    return "work";
  }
  if (tabValue === "handoff" || tabValue === "work" || tabValue === "review") {
    return tabValue;
  }
  return getDefaultAssignmentPageMode();
}

function getAssignmentLandingItemId() {
  const pageMode = getAssignmentPageMode();
  return pageMode === "handoff" || pageMode === "work" || pageMode === "review" || state.preferredTab === "assignments"
    ? parsePositiveInt(state.assignments.landingItemId, 0)
    : 0;
}

function getAssignmentLandingAssignmentId() {
  const pageMode = getAssignmentPageMode();
  return pageMode === "work" || pageMode === "review"
    ? parsePositiveInt(state.assignments.landingAssignmentId, 0)
    : 0;
}

function filterAssignmentStateActionsForRole(actions = []) {
  const rows = Array.isArray(actions) ? actions : [];
  if (!isStandardUser()) {
    return rows;
  }
  return rows.filter((row) => {
    const action = String(row?.value || "").trim().toLowerCase();
    const nextState = ASSIGNMENT_UI_ACTION_TO_STATE[action] || "";
    return nextState === "in_progress" || nextState === "revision_requested";
  });
}

function parsePositiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function getRawSelectedIds() {
  if (!(state.dashboard.rawSelectedIds instanceof Set)) {
    state.dashboard.rawSelectedIds = new Set();
  }
  return state.dashboard.rawSelectedIds;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "คำขอล้มเหลว" }));
    if (res.status === 401 && path !== "/api/auth/login") {
      persistAuthReturnTo();
      applyLogoutUI();
      redirectToLoginWithExpiredSession();
    }
    const err = new Error(data.error || "คำขอล้มเหลว");
    if (data && typeof data === "object") {
      err.payload = data;
    }
    throw err;
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return null;
}

function setStatus(id, text, isError = false) {
  const node = qs(id);
  if (!node) return;
  node.textContent = text || "";
  if (id === "assignment-status") {
    node.classList.remove("is-success", "is-error");
    if (text) {
      node.classList.add(isError ? "is-error" : "is-success");
    }
  }
  node.style.color = isError ? "#b42318" : "#1f8a52";
}

async function withButtonLoading(btn, pendingLabel, action) {
  if (typeof action !== "function") return null;
  if (!btn) return action();
  if (btn.dataset.loading === "1") return null;

  const originalLabel = btn.textContent;
  btn.dataset.loading = "1";
  btn.disabled = true;
  btn.classList.add("is-loading");
  if (pendingLabel) btn.textContent = pendingLabel;

  try {
    return await action();
  } finally {
    btn.dataset.loading = "0";
    btn.disabled = false;
    btn.classList.remove("is-loading");
    btn.textContent = originalLabel;
  }
}

function parseJsonSafe(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function getAssignmentCurrentRound(assignment = null) {
  return Math.max(1, (Number(assignment?.revision_round || 0) || 0) + 1);
}

function getAssignmentSubmissionDraftKey(assignmentId, assignment = null) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return "";
  const round = getAssignmentCurrentRound(assignment);
  return `${id}:${round}`;
}

function setAssignmentDraftSaveStatus(text = "", isError = false) {
  const node = qs("assignment-draft-save-status");
  if (!node) return;
  node.textContent = String(text || "").trim();
  node.style.color = isError ? "#b42318" : "";
}

function normalizeAssignmentSubmissionPromptAnswers(items = [], prompts = []) {
  const source = Array.isArray(items) ? items : [];
  const allowedPrompts = Array.isArray(prompts)
    ? prompts
      .map((value) => String(value?.prompt || value?.item_text || value || "").trim())
      .filter(Boolean)
    : [];
  const answerByPrompt = new Map();
  source.forEach((row) => {
    const prompt = String(row?.prompt || "").trim();
    const answer = String(row?.answer || "").trim();
    if (!prompt) return;
    if (allowedPrompts.length && !allowedPrompts.includes(prompt)) return;
    if (!answerByPrompt.has(prompt)) {
      answerByPrompt.set(prompt, answer);
    }
  });
  return allowedPrompts.map((prompt) => ({
    prompt,
    answer: String(answerByPrompt.get(prompt) || "").trim(),
  }));
}

function normalizeAssignmentKind(value, fallback = "field") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "editorial" ? "editorial" : "field";
}

function getAssignmentSubmissionKind(assignment = null) {
  const assigneeRole = String(assignment?.assignee_role || "").trim().toLowerCase();
  const fallback = assigneeRole === "editor" ? "editorial" : "field";
  return normalizeAssignmentKind(assignment?.assignment_kind, fallback);
}

function normalizeAssignmentSubmissionFieldPayload(value, fieldPack = null) {
  const payload = parseJsonSafe(value, {}) || {};
  const { mustVerify, mustCapture, mustAsk } = getFieldPackPromptGroups(fieldPack);
  return {
    verified_answers: normalizeAssignmentSubmissionPromptAnswers(payload.verified_answers, mustVerify),
    capture_answers: normalizeAssignmentSubmissionPromptAnswers(payload.capture_answers, mustCapture),
    question_answers: normalizeAssignmentSubmissionPromptAnswers(payload.question_answers, mustAsk),
    additional_text: String(payload.additional_text || "").trim(),
  };
}

function normalizeAssignmentSubmissionEditorialPayload(value, fieldPack = null) {
  const payload = parseJsonSafe(value, {}) || {};
  const { directionPrompts, sourcePrompts } = getEditorialPromptGroups(fieldPack);
  return {
    direction_answers: normalizeAssignmentSubmissionPromptAnswers(payload.direction_answers ?? payload.verified_answers, directionPrompts),
    source_answers: normalizeAssignmentSubmissionPromptAnswers(payload.source_answers ?? payload.question_answers, sourcePrompts),
    additional_text: String(payload.additional_text || "").trim(),
  };
}

function normalizeAssignmentSubmissionPayload(value, assignment = null, fieldPack = null) {
  return getAssignmentSubmissionKind(assignment) === "editorial"
    ? normalizeAssignmentSubmissionEditorialPayload(value, fieldPack)
    : normalizeAssignmentSubmissionFieldPayload(value, fieldPack);
}

function readAssignmentSubmissionDraft(assignmentId, assignment = null, fieldPack = null) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return null;
  const draftKey = getAssignmentSubmissionDraftKey(id, assignment);
  if (!draftKey) return null;
  const draftFromState = state.assignments.submissionDrafts?.[draftKey];
  if (draftFromState) {
    const payload = draftFromState?.article_payload_json && typeof draftFromState.article_payload_json === "object"
      ? draftFromState.article_payload_json
      : draftFromState;
    return normalizeAssignmentSubmissionPayload(payload, assignment, fieldPack);
  }
  return null;
}

function writeAssignmentSubmissionDraft(assignmentId, payload, assignment = null, options = {}) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return;
  const draftKey = getAssignmentSubmissionDraftKey(id, assignment);
  if (!draftKey) return;
  const normalized = {};
  const includeArticle = options?.includeArticle !== false;
  const includeRequestedChecks = options?.includeRequestedChecks === true;
  if (includeArticle) {
    normalized.article_payload_json = normalizeAssignmentSubmissionPayload(payload, assignment, state.assignments.contextFieldPack);
  }
  if (includeRequestedChecks) {
    const requestedCheckDraft = state.assignments.requestedCheckReturnDrafts?.[id] || null;
    normalized.field_return_payload_json = requestedCheckDraft
      ? buildAssignmentRequestedCheckReturnPayloadFromDraft(requestedCheckDraft)
      : null;
  }
  const currentDraft = state.assignments.submissionDrafts?.[draftKey] && typeof state.assignments.submissionDrafts[draftKey] === "object"
    ? state.assignments.submissionDrafts[draftKey]
    : {};
  const mergedDraft = {
    ...currentDraft,
    ...normalized,
  };
  state.assignments.submissionDrafts[draftKey] = mergedDraft;
  scheduleSaveAssignmentSubmissionServerDraft(id, mergedDraft, assignment);
}

function clearAssignmentSubmissionDraft(assignmentId) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return;
  const assignment = getAssignmentById(id);
  const draftKey = getAssignmentSubmissionDraftKey(id, assignment);
  if (state.assignments.submissionDrafts && typeof state.assignments.submissionDrafts === "object") {
    delete state.assignments.submissionDrafts[draftKey];
  }
  if (state.assignments.requestedCheckReturnDrafts && typeof state.assignments.requestedCheckReturnDrafts === "object") {
    delete state.assignments.requestedCheckReturnDrafts[id];
  }
  if (state.assignments.requestedCheckReturnDraftDirty && typeof state.assignments.requestedCheckReturnDraftDirty === "object") {
    delete state.assignments.requestedCheckReturnDraftDirty[id];
  }
  if (state.assignments.requestedCheckReturnDraftSources && typeof state.assignments.requestedCheckReturnDraftSources === "object") {
    delete state.assignments.requestedCheckReturnDraftSources[id];
  }
}

function clearServerDraftSaveTimer(assignmentId) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return;
  const timers = state.assignments.serverSubmissionDraftSaveTimers;
  if (!timers || typeof timers !== "object") return;
  const timerId = timers[id];
  if (timerId) {
    window.clearTimeout(timerId);
    delete timers[id];
  }
}

async function saveAssignmentSubmissionServerDraft(assignmentId, payload) {
  const id = Number(assignmentId || 0) || 0;
  if (!id || isEditorUser()) return null;
  const assignment = getAssignmentById(id);
  if (!assignment) return null;
  const assignmentState = String(assignment?.state || "").trim().toLowerCase();
  if (!["assigned", "in_progress", "revision_requested", "resubmitted"].includes(assignmentState)) {
    return null;
  }
  setAssignmentDraftSaveStatus("กำลังบันทึก...");
  const hasArticlePayload = Object.prototype.hasOwnProperty.call(payload || {}, "article_payload_json") || !payload || !Object.prototype.hasOwnProperty.call(payload, "field_return_payload_json");
  const hasFieldReturnPayload = Object.prototype.hasOwnProperty.call(payload || {}, "field_return_payload_json");
  const articlePayload = payload?.article_payload_json && typeof payload.article_payload_json === "object"
    ? payload.article_payload_json
    : payload;
  const normalized = {};
  if (hasArticlePayload) {
    normalized.article_payload_json = normalizeAssignmentSubmissionPayload(articlePayload, assignment, state.assignments.contextFieldPack);
  }
  if (hasFieldReturnPayload) {
    normalized.field_return_payload_json = payload?.field_return_payload_json && typeof payload.field_return_payload_json === "object"
      ? payload.field_return_payload_json
      : null;
  }
  const result = await api(`/api/assignments/${id}/draft`, {
    method: "PUT",
    body: JSON.stringify(normalized),
  });
  const serverDraft = result?.draft && typeof result.draft === "object" ? result.draft : normalized;
  const draftKey = getAssignmentSubmissionDraftKey(id, assignment);
  state.assignments.serverSubmissionDraftPayloads[draftKey] = {
    article_payload_json: normalizeAssignmentSubmissionPayload(
      serverDraft?.article_payload_json && typeof serverDraft.article_payload_json === "object"
        ? serverDraft.article_payload_json
        : null,
      assignment,
      state.assignments.contextFieldPack
    ),
    field_return_payload_json: serverDraft?.field_return_payload_json && typeof serverDraft.field_return_payload_json === "object"
      ? serverDraft.field_return_payload_json
      : null,
  };
  state.assignments.serverSubmissionDraftLoaded[draftKey] = true;
  const savedAt = new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  setAssignmentDraftSaveStatus(`บันทึกล่าสุด ${savedAt}`);
  return state.assignments.serverSubmissionDraftPayloads[draftKey];
}

function scheduleSaveAssignmentSubmissionServerDraft(assignmentId, payload, assignment = null) {
  const id = Number(assignmentId || 0) || 0;
  if (!id || isEditorUser()) return;
  clearServerDraftSaveTimer(id);
  state.assignments.serverSubmissionDraftSaveTimers[id] = window.setTimeout(() => {
    saveAssignmentSubmissionServerDraft(id, payload).catch(() => {
      setAssignmentDraftSaveStatus("บันทึกไม่สำเร็จ", true);
    });
    delete state.assignments.serverSubmissionDraftSaveTimers[id];
  }, 1000);
}

async function loadAssignmentSubmissionServerDraft(assignment) {
  if (isEditorUser()) return null;
  const assignmentId = Number(assignment?.id || 0) || 0;
  if (!assignmentId) return null;
  const draftKey = getAssignmentSubmissionDraftKey(assignmentId, assignment);
  const loadState = state.assignments.serverSubmissionDraftLoaded?.[draftKey];
  if (loadState === true) {
    return state.assignments.serverSubmissionDraftPayloads?.[draftKey] || null;
  }
  if (loadState === "loading") return null;
  state.assignments.serverSubmissionDraftLoaded[draftKey] = "loading";
  try {
    const result = await api(`/api/assignments/${assignmentId}/draft`);
    const draft = result?.draft && typeof result.draft === "object" ? result.draft : null;
    state.assignments.serverSubmissionDraftPayloads[draftKey] = draft
      ? {
        article_payload_json: normalizeAssignmentSubmissionPayload(
          draft?.article_payload_json && typeof draft.article_payload_json === "object" ? draft.article_payload_json : null,
          assignment,
          state.assignments.contextFieldPack
        ),
        field_return_payload_json: draft?.field_return_payload_json && typeof draft.field_return_payload_json === "object"
          ? draft.field_return_payload_json
          : null,
      }
      : null;
    state.assignments.serverSubmissionDraftLoaded[draftKey] = true;
    const serverFieldReturnPayload = state.assignments.serverSubmissionDraftPayloads?.[draftKey]?.field_return_payload_json || null;
    const serverReturns = serverFieldReturnPayload?.requested_check_returns;
    if (
      Number(state.assignments.selectedId || 0) === assignmentId
      && hasUsableAssignmentRequestedCheckReturnRows(serverFieldReturnPayload)
      && state.assignments.requestedCheckReturnDraftDirty?.[assignmentId] !== true
    ) {
      const selectedAssignment = getAssignmentById(assignmentId) || assignment;
      const handoffPackage = state.assignments.handoffSourcePackages?.[assignmentId] || null;
      const normalizedDraft = normalizeAssignmentRequestedCheckReturnDraft({ requested_check_returns: serverReturns }, handoffPackage);
      setAssignmentRequestedCheckReturnDraftState(assignmentId, normalizedDraft, { source: "server_draft", dirty: false });
      renderAssignmentRequestedCheckSection(selectedAssignment, handoffPackage, normalizedDraft);
    }
    return state.assignments.serverSubmissionDraftPayloads[draftKey];
  } catch {
    state.assignments.serverSubmissionDraftLoaded[draftKey] = false;
    return null;
  }
}

async function deleteAssignmentSubmissionServerDraft(assignmentId) {
  const id = Number(assignmentId || 0) || 0;
  if (!id || isEditorUser()) return;
  clearServerDraftSaveTimer(id);
  const assignment = getAssignmentById(id);
  const draftKey = getAssignmentSubmissionDraftKey(id, assignment);
  try {
    await api(`/api/assignments/${id}/draft`, { method: "DELETE" });
  } catch {
    // ignore delete transport errors
  }
  state.assignments.serverSubmissionDraftPayloads[draftKey] = null;
  state.assignments.serverSubmissionDraftLoaded[draftKey] = true;
  setAssignmentDraftSaveStatus("");
}

function getAssignmentSubmissionPrefillPayload(assignment, fieldPack = null) {
  const assignmentId = Number(assignment?.id || 0) || 0;
  if (!assignmentId) {
    return normalizeAssignmentSubmissionPayload(null, assignment, fieldPack);
  }
  const draftKey = getAssignmentSubmissionDraftKey(assignmentId, assignment);
  const serverDraft = state.assignments.serverSubmissionDraftPayloads?.[draftKey] || null;
  if (serverDraft) {
    return normalizeAssignmentSubmissionPayload(serverDraft.article_payload_json || null, assignment, fieldPack);
  }
  const draft = readAssignmentSubmissionDraft(assignmentId, assignment, fieldPack);
  if (draft) return draft;
  const latestPayload = state.assignments.latestSubmissionArticlePayloads?.[assignmentId] || null;
  return normalizeAssignmentSubmissionPayload(latestPayload, assignment, fieldPack);
}

function getLatestAssignmentSubmissionRow(assignment = null) {
  const assignmentId = Number(assignment?.id || state.assignments.selectedId || 0) || 0;
  if (!assignmentId) return null;
  return state.assignments.latestSubmissionRows?.[assignmentId] || null;
}

function getAssignmentRequestedCheckReturnRows(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rows = value?.requested_check_returns;
  if (!rows || typeof rows !== "object" || Array.isArray(rows)) return null;
  return rows;
}

function hasUsableAssignmentRequestedCheckReturnRows(value = null) {
  const rows = getAssignmentRequestedCheckReturnRows(value);
  return Boolean(rows && Object.keys(rows).length);
}

function setAssignmentRequestedCheckReturnDraftState(assignmentId, draft = null, options = {}) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return null;
  if (!state.assignments.requestedCheckReturnDrafts || typeof state.assignments.requestedCheckReturnDrafts !== "object") {
    state.assignments.requestedCheckReturnDrafts = {};
  }
  if (!state.assignments.requestedCheckReturnDraftDirty || typeof state.assignments.requestedCheckReturnDraftDirty !== "object") {
    state.assignments.requestedCheckReturnDraftDirty = {};
  }
  if (!state.assignments.requestedCheckReturnDraftSources || typeof state.assignments.requestedCheckReturnDraftSources !== "object") {
    state.assignments.requestedCheckReturnDraftSources = {};
  }
  if (draft) {
    state.assignments.requestedCheckReturnDrafts[id] = draft;
  } else {
    delete state.assignments.requestedCheckReturnDrafts[id];
  }
  if (Object.prototype.hasOwnProperty.call(options, "dirty")) {
    state.assignments.requestedCheckReturnDraftDirty[id] = options.dirty === true;
  }
  if (Object.prototype.hasOwnProperty.call(options, "source")) {
    state.assignments.requestedCheckReturnDraftSources[id] = options.source == null ? null : String(options.source || "").trim() || null;
  }
  return draft;
}

function normalizeAssignmentReviewAnswerItems(value) {
  return (Array.isArray(value) ? value : [])
    .map((row) => ({
      prompt: String(row?.prompt || "").trim(),
      answer: String(row?.answer || "").trim(),
    }))
    .filter((row) => row.prompt || row.answer);
}

function buildAssignmentReviewTextSections(assignment = null) {
  const fieldPack = state.assignments.contextFieldPack && typeof state.assignments.contextFieldPack === "object"
    ? state.assignments.contextFieldPack
    : null;
  const latestSubmission = getLatestAssignmentSubmissionRow(assignment);
  const payload = normalizeAssignmentSubmissionPayload(
    latestSubmission?.article_payload_json || state.assignments.latestSubmissionArticlePayloads?.[Number(assignment?.id || 0) || 0] || null,
    assignment,
    fieldPack
  );
  const kind = getAssignmentSubmissionKind(assignment);
  if (kind === "editorial") {
    return [
      {
        label: "แนวสื่อสารหลัก",
        items: normalizeAssignmentReviewAnswerItems(payload?.direction_answers),
      },
      {
        label: "ข้อมูล/มุมที่ใช้อ้างอิง",
        items: normalizeAssignmentReviewAnswerItems(payload?.source_answers),
      },
      {
        label: "โน้ตเพิ่มเติม",
        text: String(payload?.additional_text || "").trim(),
      },
    ];
  }
  return [
    {
      label: "สิ่งที่ยืนยันจากหน้างาน",
      items: normalizeAssignmentReviewAnswerItems(payload?.verified_answers),
    },
    {
      label: "สิ่งที่ถ่าย / หมายเหตุประกอบไฟล์",
      items: normalizeAssignmentReviewAnswerItems(payload?.capture_answers),
    },
    {
      label: "คำตอบจากหน้างาน",
      items: normalizeAssignmentReviewAnswerItems(payload?.question_answers),
    },
    {
      label: "ข้อความเพิ่มเติม",
      text: String(payload?.additional_text || "").trim(),
    },
  ];
}

function normalizeUserProfileModel(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : parseJsonSafe(value, {}) || {};
  const picAssetId = Number(source.pic_asset_id || 0) || 0;
  return {
    display_name: String(source.display_name || "").trim(),
    phone: String(source.phone || "").trim(),
    email_alt: String(source.email_alt || "").trim().toLowerCase(),
    line_id: String(source.line_id || "").trim(),
    pic_asset_id: picAssetId > 0 ? picAssetId : null,
  };
}

function extractUserProfile(user) {
  const profile = normalizeUserProfileModel(user?.profile_json);
  profile.display_name = profile.display_name || String(user?.display_name || "").trim();
  return profile;
}

function summarizeUserProfile(user) {
  const profile = extractUserProfile(user);
  const parts = [];
  if (profile.phone) parts.push(`โทร ${profile.phone}`);
  if (profile.email_alt) parts.push(`เมลสำรอง ${profile.email_alt}`);
  if (profile.line_id) parts.push(`LINE ${profile.line_id}`);
  if (profile.pic_asset_id) parts.push(`รูป #${profile.pic_asset_id}`);
  return parts.join(" | ") || "-";
}

function getSafeRoleClass(role) {
  const value = String(role || "user").trim().toLowerCase();
  return /^[a-z0-9_-]+$/.test(value) ? value : "unknown";
}

function normalizeTextKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function normalizePlaceTitleKey(value) {
  return normalizeTextKey(
    String(value || "")
      .replace(/^ร้าน\s*/i, "")
      .replace(/\s*-\s*$/, "")
  );
}

function extractAlternateTitles(...values) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const matches = text.matchAll(/\(([^()]{4,120})\)/g);
    for (const match of matches) {
      const candidate = String(match?.[1] || "").trim();
      if (!candidate) continue;
      if (!/[a-z]/i.test(candidate) && !/[ก-๙]/.test(candidate)) continue;
      const key = normalizePlaceTitleKey(candidate);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(candidate);
    }
  }
  return out;
}

function normalizeCategoryFamily(value, tags = []) {
  const raw = [value, ...(Array.isArray(tags) ? tags : [])]
    .map((part) => String(part || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");

  if (!raw) return "";
  if (/คาเฟ่|cafe|coffee_shop|coffee|กาแฟ/.test(raw)) return "cafe";
  if (/restaurant|food|ร้านอาหาร|อาหาร/.test(raw)) return "restaurant";
  if (/hotel|lodging|ที่พัก/.test(raw)) return "hotel";
  if (/activity|กิจกรรม/.test(raw)) return "activity";
  if (/transport|การเดินทาง/.test(raw)) return "transport";
  if (/attraction|tourist|ที่เที่ยว/.test(raw)) return "attraction";
  return raw;
}

function normalizeAddressKey(value) {
  const text = String(value || "")
    .replace(/ประเทศไทย/g, " ")
    .replace(/หมู่ที่/gi, "หมู่ ")
    .replace(/ตำบล|แขวง/gi, " ")
    .replace(/อำเภอ|เขต/gi, " ")
    .replace(/จังหวัด/gi, " ")
    .replace(/\|/g, " ")
    .replace(/[,:;()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const key = normalizeTextKey(text);
  return key.length >= 18 ? key : "";
}

function normalizePhoneKey(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "").trim();
  if (!digits) return "";
  if (digits.startsWith("+66")) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith("66") && digits.length >= 9) {
    return `0${digits.slice(2)}`;
  }
  return digits.replace(/^\+/, "");
}

function isActionableMergeMatch(match) {
  const reasons = Array.isArray(match?.reasons) ? match.reasons : [];
  return reasons.some((reason) =>
    reason === "ชื่อรายการตรงกัน" ||
    reason === "ชื่อใกล้เคียง" ||
    reason === "ชื่อทางเลือกตรงกัน" ||
    reason === "ชื่อทางเลือกใกล้เคียง" ||
    reason === "ที่อยู่ใกล้เคียง" ||
    reason === "เบอร์โทรตรงกัน" ||
    reason === "พิกัดใกล้กัน" ||
    reason === "source URL ตรงกัน" ||
    reason === "source entity ตรงกัน"
  );
}

function splitSearchTokens(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[\s,|/()\-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function compactText(value, maxLen = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "-";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

function normalizeFactArray(value, limit = 5) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= Math.max(1, Number(limit || 5))) break;
  }
  return out;
}

function formatFactList(values, maxLen = 160) {
  const text = normalizeFactArray(values, 5).join(" | ");
  return text ? compactText(text, maxLen) : "-";
}

const SOURCE_INPUT_CONFIG = Object.freeze({
  google_maps: Object.freeze({
    label: "คำค้นหาสถานที่",
    help: "ใช้สำหรับค้นหาสถานที่จาก Google Maps",
    placeholder: "เช่น วัดหนองบัว อุบลราชธานี",
    multiline: false,
  }),
  manual: Object.freeze({
    label: "วาง URL แหล่งข้อมูล",
    help: "วาง 1 URL ต่อ 1 บรรทัด ระบบจะอ่าน metadata จากแต่ละลิงก์ก่อนเปิดหน้าคัดรับเข้า raw",
    placeholder: "https://example.com/place-1\nhttps://example.com/place-2",
    multiline: true,
  }),
  facebook: Object.freeze({
    label: "วาง URL แหล่งข้อมูล",
    help: "ใช้สำหรับวาง URL ที่ต้องการนำเข้าแบบ manual_url",
    placeholder: "https://www.facebook.com/...",
    multiline: true,
  }),
  tiktok: Object.freeze({
    label: "วาง URL แหล่งข้อมูล",
    help: "ใช้สำหรับวาง URL ที่ต้องการนำเข้าแบบ manual_url",
    placeholder: "https://www.tiktok.com/...",
    multiline: true,
  }),
});

function getAllowedSourceAdaptersForRole(role = currentRole()) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "owner") {
    return ["google_maps", "manual", "facebook", "tiktok"];
  }
  return ["manual", "facebook", "tiktok"];
}

function syncSourceAdapterOptionsForRole() {
  const select = qs("source-adapter");
  if (!select) return "manual";

  const allowed = new Set(getAllowedSourceAdaptersForRole(currentRole()));
  const fallback = allowed.has("manual") ? "manual" : (Array.from(allowed)[0] || "manual");

  for (const option of Array.from(select.options || [])) {
    const value = String(option?.value || "").trim().toLowerCase();
    const visible = allowed.has(value);
    if (visible) {
      option.hidden = false;
      option.disabled = false;
      option.removeAttribute("hidden");
      option.removeAttribute("disabled");
    } else {
      option.hidden = true;
      option.disabled = true;
      option.setAttribute("hidden", "");
      option.setAttribute("disabled", "");
    }
  }

  const selected = String(select.value || "").trim().toLowerCase();
  if (!allowed.has(selected)) {
    select.value = fallback;
  }
  return String(select.value || fallback).trim().toLowerCase();
}

function toDomainLabel(value) {
  return String(value || "").trim().replace(/^www\./i, "");
}

function toManualUrlRows(rawValue) {
  const rows = String(rawValue || "")
    .split(/\r?\n+/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  if (!rows.length) {
    throw new Error("กรุณาวาง URL อย่างน้อย 1 รายการ");
  }

  return rows.map((line) => {
    let parsed;
    try {
      parsed = new URL(line);
    } catch {
      throw new Error(`URL ไม่ถูกต้อง: ${line}`);
    }

    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error(`URL ต้องขึ้นต้นด้วย http หรือ https: ${line}`);
    }

    const host = toDomainLabel(parsed.hostname);

    return {
      type: "place",
      lang: "th",
      source_name: host || "manual-url",
      source_url: line,
      website_url: line,
      tags: ["manual-url", host].filter(Boolean),
      source_ref: line,
      payload_json: {
        submitted_url: line,
        hostname: host,
      },
    };
  });
}

function looksLikeUrlInput(rawValue) {
  const rows = String(rawValue || "")
    .split(/\r?\n+/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  return rows.length > 0 && rows.every((line) => /^https?:\/\//i.test(line));
}

function getSourceQueryValue() {
  const input = qs("source-query-input");
  const textarea = qs("source-query-textarea");
  if (textarea && !textarea.classList.contains("hidden")) {
    return String(textarea.value || "").trim();
  }
  return String(input?.value || "").trim();
}

function syncSourceQueryValue(nextValue = "") {
  const value = String(nextValue || "");
  const input = qs("source-query-input");
  const textarea = qs("source-query-textarea");
  if (input && input.value !== value) input.value = value;
  if (textarea && textarea.value !== value) textarea.value = value;
}

function getSourceLocationPanelElements() {
  return {
    toggleButton: qs("btn-source-location-panel-toggle"),
    panel: qs("source-location-panel"),
    useRestriction: qs("source-use-location-restriction"),
    latitude: qs("source-location-latitude"),
    longitude: qs("source-location-longitude"),
    radiusM: qs("source-location-radius-m"),
    maxResultsPerQuery: qs("source-max-results-per-query"),
    summary: qs("source-location-summary"),
    error: qs("source-location-error"),
  };
}

function syncSourceLocationPanelToggleLabel() {
  const { toggleButton, panel } = getSourceLocationPanelElements();
  if (!toggleButton) return;
  const isOpen = Boolean(panel?.open);
  toggleButton.textContent = isOpen ? "ซ่อน advanced location filter" : "Advanced location filter";
}

function readSourceLocationPanelState() {
  const elements = getSourceLocationPanelElements();
  return {
    useLocationRestriction: Boolean(elements.useRestriction?.checked),
    latitude: String(elements.latitude?.value || "").trim(),
    longitude: String(elements.longitude?.value || "").trim(),
    radiusM: String(elements.radiusM?.value || "").trim(),
    maxResultsPerQuery: String(elements.maxResultsPerQuery?.value || "20").trim() || "20",
  };
}

function clearSourceLocationPanelError() {
  const { error } = getSourceLocationPanelElements();
  if (!error) return;
  error.textContent = "";
  error.classList.add("hidden");
}

function showSourceLocationPanelError(message) {
  const { error } = getSourceLocationPanelElements();
  if (!error) return;
  error.textContent = String(message || "").trim();
  error.classList.toggle("hidden", !error.textContent);
}

function parseDecimalCoordinate(value, min, max) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function parseDmsCoordinate(value, axis) {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = text
    .replace(/[“”]/g, "\"")
    .replace(/[′’]/g, "'")
    .replace(/[″]/g, "\"")
    .replace(/[º]/g, "°")
    .toUpperCase();
  const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)\s*°\s*(\d+(?:\.\d+)?)?\s*(?:'|MIN)?\s*(\d+(?:\.\d+)?)?\s*(?:\"|SEC)?\s*([NSEW])$/);
  if (!match) return null;
  const deg = Number(match[1]);
  const min = Number(match[2] || 0);
  const sec = Number(match[3] || 0);
  const hemisphere = match[4];
  if (!Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  if (min < 0 || min >= 60 || sec < 0 || sec >= 60) return null;
  if (axis === "latitude" && hemisphere !== "N" && hemisphere !== "S") return null;
  if (axis === "longitude" && hemisphere !== "E" && hemisphere !== "W") return null;
  let out = Math.abs(deg) + (min / 60) + (sec / 3600);
  if (hemisphere === "S" || hemisphere === "W" || deg < 0) out *= -1;
  const minAllowed = axis === "latitude" ? -90 : -180;
  const maxAllowed = axis === "latitude" ? 90 : 180;
  if (out < minAllowed || out > maxAllowed) return null;
  return out;
}

function parseSingleCoordinate(value, axis) {
  if (axis === "latitude") {
    return parseDecimalCoordinate(value, -90, 90) ?? parseDmsCoordinate(value, axis);
  }
  return parseDecimalCoordinate(value, -180, 180) ?? parseDmsCoordinate(value, axis);
}

function extractCoordinatePairFromText(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const normalized = text
    .replace(/[“”]/g, "\"")
    .replace(/[′’]/g, "'")
    .replace(/[″]/g, "\"")
    .replace(/[º]/g, "°")
    .replace(/\s+/g, " ")
    .trim();
  const pairMatch = normalized.match(/(\d+(?:\.\d+)?\s*°\s*\d+(?:\.\d+)?\s*(?:'|MIN)?\s*\d+(?:\.\d+)?\s*(?:\"|SEC)?\s*[NS])[\s,]+(\d+(?:\.\d+)?\s*°\s*\d+(?:\.\d+)?\s*(?:'|MIN)?\s*\d+(?:\.\d+)?\s*(?:\"|SEC)?\s*[EW])/i);
  if (!pairMatch) return null;
  const latitude = parseSingleCoordinate(pairMatch[1], "latitude");
  const longitude = parseSingleCoordinate(pairMatch[2], "longitude");
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function normalizeSourceLocationPairInputs() {
  const elements = getSourceLocationPanelElements();
  if (!elements.latitude || !elements.longitude) return;
  const fromLatitude = extractCoordinatePairFromText(elements.latitude.value);
  if (fromLatitude) {
    elements.latitude.value = String(fromLatitude.latitude);
    elements.longitude.value = String(fromLatitude.longitude);
    return;
  }
  const fromLongitude = extractCoordinatePairFromText(elements.longitude.value);
  if (fromLongitude) {
    elements.latitude.value = String(fromLongitude.latitude);
    elements.longitude.value = String(fromLongitude.longitude);
  }
}

function parseSourceLocationPanelState(state = readSourceLocationPanelState()) {
  if (!state.useLocationRestriction) {
    return { ok: true, values: null, firstInvalidField: null };
  }

  const lat = parseSingleCoordinate(state.latitude, "latitude");
  if (!state.latitude || !Number.isFinite(lat)) {
    return { ok: false, values: null, firstInvalidFieldKey: "latitude", message: "Latitude ต้องอยู่ในช่วง -90 ถึง 90" };
  }

  const lng = parseSingleCoordinate(state.longitude, "longitude");
  if (!state.longitude || !Number.isFinite(lng)) {
    return { ok: false, values: null, firstInvalidFieldKey: "longitude", message: "Longitude ต้องอยู่ในช่วง -180 ถึง 180" };
  }

  const radius = Number(state.radiusM);
  if (
    !state.radiusM
    || !Number.isInteger(radius)
    || radius < 1
    || radius > 50000
  ) {
    return { ok: false, values: null, firstInvalidFieldKey: "radiusM", message: "Radius (m) ต้องเป็นจำนวนเต็ม 1 ถึง 50000" };
  }

  return {
    ok: true,
    values: {
      latitude: lat,
      longitude: lng,
      radiusM: radius,
    },
    firstInvalidFieldKey: null,
  };
}

function validateSourceLocationPanelState() {
  const elements = getSourceLocationPanelElements();
  const parsed = parseSourceLocationPanelState();
  if (parsed.ok) {
    clearSourceLocationPanelError();
    return {
      ...parsed,
      firstInvalidField: null,
    };
  }
  showSourceLocationPanelError(parsed.message);
  const field = parsed.firstInvalidFieldKey ? elements[parsed.firstInvalidFieldKey] : null;
  return {
    ...parsed,
    firstInvalidField: field || null,
  };
}

function focusFirstInvalidSourceLocationField(validationResult) {
  const field = validationResult?.firstInvalidField;
  if (!field || typeof field.focus !== "function") return;
  field.focus();
}

function syncSourceLocationPanelSummary() {
  const { summary } = getSourceLocationPanelElements();
  if (!summary) return;
  const state = readSourceLocationPanelState();
  if (!state.useLocationRestriction) {
    summary.textContent = "สถานะ: ไม่ได้จำกัดพื้นที่";
    return;
  }
  const lat = state.latitude || "-";
  const lng = state.longitude || "-";
  const radius = state.radiusM || "-";
  summary.textContent = `สถานะ: จำกัดพื้นที่ (lat ${lat}, lng ${lng}, radius ${radius} m)`;
}

function resetSourceLocationPanelState() {
  const elements = getSourceLocationPanelElements();
  if (elements.useRestriction) elements.useRestriction.checked = false;
  if (elements.latitude) elements.latitude.value = "";
  if (elements.longitude) elements.longitude.value = "";
  if (elements.radiusM) elements.radiusM.value = "";
  if (elements.maxResultsPerQuery) elements.maxResultsPerQuery.value = "20";
  clearSourceLocationPanelError();
  syncSourceLocationPanelSummary();
}

function updateSourceLocationPanelVisibility(adapter) {
  const { panel, toggleButton } = getSourceLocationPanelElements();
  if (!panel) return;
  const hidden = adapter !== "google_maps";
  panel.classList.toggle("hidden", hidden);
  if (toggleButton) {
    toggleButton.classList.toggle("hidden", hidden);
  }
  syncSourceLocationPanelToggleLabel();
}

function updateSourceInputUI() {
  const adapter = syncSourceAdapterOptionsForRole();
  const config = SOURCE_INPUT_CONFIG[adapter] || SOURCE_INPUT_CONFIG.manual;
  const label = qs("source-input-label");
  const help = qs("source-input-help");
  const input = qs("source-query-input");
  const textarea = qs("source-query-textarea");
  const currentValue = getSourceQueryValue();

  if (label) label.textContent = config.label;
  if (help) help.textContent = config.help;
  if (input) {
    input.placeholder = config.placeholder;
    input.classList.toggle("hidden", Boolean(config.multiline));
  }
  if (textarea) {
    textarea.placeholder = config.placeholder;
    textarea.classList.toggle("hidden", !config.multiline);
  }
  syncSourceQueryValue(currentValue);
  updateSourceLocationPanelVisibility(adapter);
  syncSourceLocationPanelSummary();
  if (adapter !== "google_maps") {
    clearSourceLocationPanelError();
  }
}

function toFiniteNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toCategoryLabel(category) {
  const map = Object.fromEntries(CONTENT_CATEGORY_OPTIONS.map((entry) => [entry.value, entry.label]));
  return map[String(category || "").trim()] || String(category || "-").trim() || "-";
}

function formatAssignmentContextFieldPackStatusLabel(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "ready_for_field" || value === "ready_for_handoff") return "พร้อมส่งเข้า handoff";
  if (value === "draft") return "ยังจัด brief";
  if (value === "field_in_progress") return "กำลังลงหน้างาน";
  if (value === "field_done") return "ลงหน้างานแล้ว";
  if (value === "on_hold") return "พักไว้";
  if (!value) return "-";
  return "ไม่ทราบสถานะ";
}

function renderHandoffQueueStatusBadge(item) {
  const ready = isHandoffEligibleItem(item);
  const rawStatus = String(item?.current_field_pack_status || item?.field_pack_status || "").trim().toLowerCase();
  const label = ready
    ? "ready_for_handoff"
    : (rawStatus || "-");
  const title = escapeHtml(rawStatus || "-");
  return `<span class="workflow-badge workflow-badge-generated" title="field_pack_status: ${title}">${escapeHtml(label)}</span>`;
}

function interestingnessBadgeClass(label) {
  if (label === "น่าทำก่อน") return "priority-top";
  if (label === "มีศักยภาพ") return "priority-good";
  if (label === "ต้องตรวจเอง") return "priority-check";
  return "priority-low";
}

function sortRawItems(items = []) {
  const list = Array.isArray(items) ? [...items] : [];
  const mode = String(state.dashboard.rawSort || "interestingness").trim().toLowerCase();
  list.sort((a, b) => {
    if (mode === "id_asc") {
      return Number(a?.id || 0) - Number(b?.id || 0);
    }
    if (mode === "title_asc") {
      return String(a?.title || "").localeCompare(String(b?.title || ""), "th");
    }
    if (mode === "id_desc") {
      return Number(b?.id || 0) - Number(a?.id || 0);
    }
    const scoreDiff = Number(b?.interestingness?.score || 0) - Number(a?.interestingness?.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const rankDiff = Number(b?.interestingness?.rank || 0) - Number(a?.interestingness?.rank || 0);
    if (rankDiff !== 0) return rankDiff;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });
  return list;
}

function intakePriorityClass(label) {
  if (label === "น่ารับก่อน") return "priority-top";
  if (label === "มีศักยภาพ") return "priority-good";
  if (label === "ต้องตรวจเอง") return "priority-check";
  return "priority-low";
}

function intakeMergeClass(label) {
  if (label === "พบรายการเดิมที่เกี่ยวข้องมาก") return "merge-exact";
  if (label === "พบรายการใกล้เคียง") return "merge-near";
  return "merge-none";
}

function shouldRecommendMerge(merge) {
  const suggested = merge?.suggested || null;
  const reasons = Array.isArray(suggested?.reasons) ? suggested.reasons : [];
  const score = Number(suggested?.score || 0) || 0;
  const hasSourceIdentity = reasons.includes("source URL ตรงกัน") || reasons.includes("source entity ตรงกัน");
  const hasCorroboration =
    reasons.includes("ชื่อรายการตรงกัน") ||
    reasons.includes("ชื่อใกล้เคียง") ||
    reasons.includes("พิกัดใกล้กัน");

  if (hasSourceIdentity && hasCorroboration) return true;
  if (score >= 14) return true;
  return false;
}

function scoreIntakePriority(candidate, query) {
  let score = 0;
  const reasons = [];
  const tokens = splitSearchTokens(query);
  const haystack = `${candidate.title} ${candidate.snippet} ${candidate.category}`.toLowerCase();

  if (tokens.length && tokens.some((token) => haystack.includes(token))) {
    score += 2;
    reasons.push("ตรงคำค้น");
  }
  if (candidate.rating != null) {
    score += candidate.rating >= 4.5 ? 2 : candidate.rating >= 4.1 ? 1 : 0;
    if (candidate.rating >= 4.1) reasons.push("คะแนนรีวิวสูง");
  }
  const popularityCount = candidate.userRatingCount ?? candidate.reviewCount;
  if (popularityCount != null) {
    score += popularityCount >= 200 ? 2 : popularityCount >= 40 ? 1 : 0;
    if (popularityCount >= 40) reasons.push("มีรีวิวจำนวนมาก");
  }
  if (candidate.hasEditorialSummary) {
    score += 1;
    reasons.push("มีคำอธิบายตั้งต้น");
  }
  if (candidate.hasReviewSnippets) {
    score += 1;
    reasons.push("มีรีวิวให้สกัดต่อ");
  }
  if (candidate.hasWebsite) {
    score += 1;
    reasons.push("มีเว็บไซต์อ้างอิง");
  }
  if (candidate.hasOpeningHours || candidate.hasPhone) {
    score += 1;
    reasons.push("ข้อมูลใช้งานค่อนข้างครบ");
  }

  let label = "ไม่น่ารับ";
  let rank = 0;
  if (score >= 6) {
    label = "น่ารับก่อน";
    rank = 3;
  } else if (score >= 4) {
    label = "มีศักยภาพ";
    rank = 2;
  } else if (score >= 2) {
    label = "ต้องตรวจเอง";
    rank = 1;
  }

  if (!reasons.length) {
    reasons.push("ข้อมูลยังบาง");
  }

  return { label, rank, score, reasons: reasons.slice(0, 4) };
}

function findCandidateMatches(candidate, items) {
  const list = Array.isArray(items) ? items : [];
  const candidateTitleKey = normalizePlaceTitleKey(candidate.title);
  const candidateAlternateTitleKeys = (Array.isArray(candidate.alternateTitles) ? candidate.alternateTitles : [])
    .map((value) => normalizePlaceTitleKey(value))
    .filter(Boolean);
  const candidateSourceUrl = String(candidate.sourceUrl || "").trim().toLowerCase();
  const candidateEntityId = String(candidate.sourceEntityId || "").trim().toLowerCase();
  const candidateLat = toFiniteNumberOrNull(candidate.latitude);
  const candidateLng = toFiniteNumberOrNull(candidate.longitude);
  const candidateCategoryFamily = normalizeCategoryFamily(candidate.category, candidate.tags);
  const candidateAddressKey = normalizeAddressKey(candidate.address);
  const candidatePhoneKey = normalizePhoneKey(candidate.phone);

  const matches = list.map((item) => {
    let score = 0;
    const reasons = [];
    const itemSourceUrl = String(item?.source_url || "").trim().toLowerCase();
    const itemEntityId = String(item?.google_place_id || item?.source_entity_id || "").trim().toLowerCase();
    const itemTitleKey = normalizePlaceTitleKey(item?.title || "");
    const itemAlternateTitleKeys = extractAlternateTitles(item?.title || "", item?.description_raw || "", item?.summary || "")
      .map((value) => normalizePlaceTitleKey(value))
      .filter(Boolean);
    const itemLat = toFiniteNumberOrNull(item?.latitude);
    const itemLng = toFiniteNumberOrNull(item?.longitude);
    const itemCategoryFamily = normalizeCategoryFamily(item?.category, item?.tags);
    const sameCategory = String(item?.category || "").trim() === String(candidate.category || "").trim();
    const sameCategoryFamily = candidateCategoryFamily && itemCategoryFamily && candidateCategoryFamily === itemCategoryFamily;
    const itemAddressKey = normalizeAddressKey(item?.description_raw || item?.summary || "");
    const itemPhoneKey = normalizePhoneKey(item?.match_phone);

    if (candidateSourceUrl && itemSourceUrl && candidateSourceUrl === itemSourceUrl) {
      score += 4;
      reasons.push("source URL ตรงกัน");
    }
    if (candidateEntityId && itemEntityId && candidateEntityId === itemEntityId) {
      score += 4;
      reasons.push("source entity ตรงกัน");
    }
    if (candidateTitleKey && itemTitleKey && candidateTitleKey === itemTitleKey) {
      score += sameCategory || sameCategoryFamily ? 10 : 8;
      reasons.push("ชื่อรายการตรงกัน");
    } else if (candidateTitleKey && itemTitleKey && (candidateTitleKey.includes(itemTitleKey) || itemTitleKey.includes(candidateTitleKey))) {
      score += sameCategory || sameCategoryFamily ? 6 : 4;
      reasons.push("ชื่อใกล้เคียง");
    }
    if (!reasons.includes("ชื่อรายการตรงกัน") && !reasons.includes("ชื่อใกล้เคียง")) {
      const candidateAliasMatched = candidateAlternateTitleKeys.some((key) => key === itemTitleKey || itemAlternateTitleKeys.includes(key));
      const candidateAliasNear = candidateAlternateTitleKeys.some((key) =>
        key && itemTitleKey && (key.includes(itemTitleKey) || itemTitleKey.includes(key))
      );
      if (candidateAliasMatched) {
        score += sameCategory || sameCategoryFamily ? 9 : 7;
        reasons.push("ชื่อทางเลือกตรงกัน");
      } else if (candidateAliasNear) {
        score += sameCategory || sameCategoryFamily ? 5 : 3;
        reasons.push("ชื่อทางเลือกใกล้เคียง");
      }
    }
    if (candidateAddressKey && itemAddressKey && (candidateAddressKey.includes(itemAddressKey) || itemAddressKey.includes(candidateAddressKey))) {
      score += 8;
      reasons.push("ที่อยู่ใกล้เคียง");
    }
    if (candidatePhoneKey && itemPhoneKey && candidatePhoneKey === itemPhoneKey) {
      score += 8;
      reasons.push("เบอร์โทรตรงกัน");
    }
    if (candidateLat != null && candidateLng != null && itemLat != null && itemLng != null) {
      const latDiff = Math.abs(candidateLat - itemLat);
      const lngDiff = Math.abs(candidateLng - itemLng);
      if (latDiff <= 0.002 && lngDiff <= 0.002) {
        score += 6;
        reasons.push("พิกัดใกล้กัน");
      }
    }
    if (sameCategory) {
      score += 1;
    } else if (sameCategoryFamily) {
      score += 2;
      reasons.push("หมวดใกล้เคียง");
    }

    return {
      item,
      score,
      reasons: reasons.slice(0, 3),
    };
  }).filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const topMatch = matches[0] || null;

  let label = "ไม่พบรายการใกล้เคียง";
  let rank = 0;
  if (topMatch?.score >= 10 && isActionableMergeMatch(topMatch)) {
    label = "พบรายการเดิมที่เกี่ยวข้องมาก";
    rank = 2;
  } else if (topMatch?.score >= 5 && isActionableMergeMatch(topMatch)) {
    label = "พบรายการใกล้เคียง";
    rank = 1;
  }

  return {
    label,
    rank,
    suggested: rank > 0 ? topMatch : null,
    matches,
  };
}

function normalizeRawCandidate(row, query) {
  const normalized = parseJsonSafe(row?.normalized_json, {}) || {};
  const payload = parseJsonSafe(row?.payload_json, {}) || {};
  const extractedPayload = resolveExtractedPayload(payload);
  const extractedMetadata = extractedPayload.extractedMetadata;
  const extractedArticle = extractedPayload.extractedArticle;
  const extractedReviews = extractedPayload.extractedReviews;
  const title = String(normalized.title || row?.title_raw || "").trim() || "(ยังไม่มีชื่อรายการ)";
  const snippet = String(
    normalized.editorial_summary ||
    normalized.description ||
    extractedArticle.excerpt ||
    extractedArticle.body_text ||
    row?.description_raw ||
    ""
  ).trim();
  const alternateTitles = Array.isArray(normalized.alternate_titles) && normalized.alternate_titles.length
    ? normalized.alternate_titles
    : extractAlternateTitles(
        normalized.title,
        normalized.description,
        normalized.editorial_summary,
        extractedArticle.headline,
        extractedArticle.excerpt,
        row?.title_raw,
        row?.description_raw
      );
  const normalizedAddress = String(normalized.full_address_normalized || extractedMetadata.full_address_normalized || extractedMetadata.address || "").trim();
  const normalizedPhone = String(
    normalized.phone_normalized ||
    normalized.national_phone_number ||
    normalized.international_phone_number ||
    extractedMetadata.phone_normalized ||
    ""
  ).trim();
  const openingHours = normalizeFactArray(
    Array.isArray(normalized.opening_hours_weekday_text) && normalized.opening_hours_weekday_text.length
      ? normalized.opening_hours_weekday_text
      : extractedMetadata.opening_hours,
    3
  );
  const serviceFacts = normalizeFactArray(extractedMetadata.service_facts, 4);
  const priceSignals = normalizeFactArray(extractedMetadata.price_signals, 4);
  const menuSections = normalizeFactArray(extractedMetadata.menu_sections, 4);
  const menuHighlights = normalizeFactArray(extractedMetadata.menu_highlights, 4);
  const candidate = {
    rawItemId: Number(row?.id || 0),
    batchUid: String(row?.batch_uid || "").trim(),
    title,
    alternateTitles,
    type: String(normalized.type || "place").trim(),
    category: String(normalized.category || "attractions").trim(),
    categoryLabel: toCategoryLabel(normalized.category || "attractions"),
    sourceUrl: String(normalized.source_url || row?.source_url || "").trim(),
    sourceEntityId: String(normalized.google_place_id || row?.source_ref || "").trim(),
    sourceType: String(row?.source_type || "").trim() || "raw",
    snippet: compactText(snippet, 220),
    rating: toFiniteNumberOrNull(normalized.rating ?? extractedMetadata.rating),
    reviewCount: toFiniteNumberOrNull(normalized.review_count ?? extractedMetadata.review_count),
    userRatingCount: toFiniteNumberOrNull(normalized.user_rating_count ?? extractedMetadata.user_rating_count),
    latitude: toFiniteNumberOrNull(normalized.latitude ?? extractedMetadata.latitude),
    longitude: toFiniteNumberOrNull(normalized.longitude ?? extractedMetadata.longitude),
    address: normalizedAddress,
    phone: normalizedPhone,
    openingHours,
    serviceFacts,
    priceSignals,
    menuUrl: String(extractedMetadata.menu_url || "").trim(),
    menuSections,
    menuHighlights,
    tags: Array.isArray(normalized.tags) ? normalized.tags : Array.isArray(extractedMetadata.types) ? extractedMetadata.types : [],
    hasWebsite: Boolean(String(normalized.website_url || extractedMetadata.website_url || "").trim()),
    hasPhone: Boolean(normalizedPhone),
    hasOpeningHours: openingHours.length > 0,
    hasEditorialSummary: Boolean(String(normalized.editorial_summary || extractedArticle.excerpt || extractedArticle.body_text || "").trim()),
    hasReviewSnippets:
      (Array.isArray(normalized.review_snippets) && normalized.review_snippets.length > 0) ||
      (Array.isArray(extractedReviews.items) && extractedReviews.items.length > 0),
    hasServiceFacts: serviceFacts.length > 0,
    hasPriceSignals: priceSignals.length > 0,
    hasMenuFacts: menuSections.length > 0 || menuHighlights.length > 0 || Boolean(String(extractedMetadata.menu_url || "").trim()),
  };

  const priority = scoreIntakePriority(candidate, query);
  const merge = findCandidateMatches(candidate, state.items);
  const recommendedDecision = shouldRecommendMerge(merge) ? "merge" : priority.rank >= 1 ? "new" : "skip";

  return {
    ...candidate,
    priority,
    merge,
    recommendedDecision,
    selectedDecision: recommendedDecision === "skip" ? "skip" : "accept",
  };
}

function readExtractedObject(payload, key) {
  if (payload && typeof payload === "object" && payload[key] && typeof payload[key] === "object") {
    return payload[key];
  }
  const nestedPayload = payload?.payload_json;
  if (nestedPayload && typeof nestedPayload === "object" && nestedPayload[key] && typeof nestedPayload[key] === "object") {
    return nestedPayload[key];
  }
  return {};
}

function resolveExtractedPayload(payload) {
  return {
    extractedMetadata: readExtractedObject(payload, "extracted_metadata"),
    extractedArticle: readExtractedObject(payload, "extracted_article"),
    extractedReviews: readExtractedObject(payload, "extracted_reviews"),
  };
}

function buildRawCandidateSummary(candidate) {
  const parts = [];
  if (candidate.rating != null) parts.push(`คะแนน ${candidate.rating}`);
  if (candidate.userRatingCount != null) {
    parts.push(`ผู้ให้คะแนน ${candidate.userRatingCount}`);
  } else if (candidate.reviewCount != null) {
    parts.push(`รีวิว ${candidate.reviewCount}`);
  }
  if (candidate.reviewCount != null && candidate.reviewCount !== candidate.userRatingCount) {
    parts.push(`รีวิวที่เก็บ ${candidate.reviewCount}`);
  }
  if (candidate.sourceType) parts.push(candidate.sourceType);
  return parts.join(" | ") || "ยังไม่มีสัญญาณเด่น";
}

function setPanelVisibility(tabId, panelId, visible, fallbackTabId = "tab-assignments") {
  const tab = qs(tabId);
  const panel = qs(panelId);
  if (!tab || !panel) return;

  tab.classList.toggle("hidden", !visible);
  panel.classList.toggle("hidden", !visible);

  if (!visible && panel.classList.contains("active")) {
    const fallbackNode = qs(fallbackTabId);
    const fallbackRequestedTab = String(fallbackNode?.dataset?.tab || "").trim().toLowerCase();
    if (fallbackRequestedTab) {
      applyLandingState({
        requestedTab: fallbackRequestedTab,
        fallbackTab: state.preferredTab,
        syncUrl: true,
        refreshAssignments: true,
        reason: "setPanelVisibility-fallback",
      });
      return;
    }
    state.preferredTab = "home";
    syncPreferredTabUrl();
    activateIndexPanelForPreferredTab();
  }
}

function syncIndexShellChrome(preferredTab = state.preferredTab) {
  const normalizedPreferredTab = String(preferredTab || "").trim().toLowerCase();
  const shell = qs("app-shell");
  if (shell) {
    shell.classList.toggle("home-dashboard-mode", normalizedPreferredTab === "home");
    shell.classList.toggle("raw-process-mode", normalizedPreferredTab === "raw");
    shell.classList.toggle("users-management-mode", normalizedPreferredTab === "users");
    shell.classList.toggle(
      "assignment-process-mode",
      ["handoff", "work", "review", "assignments"].includes(normalizedPreferredTab)
    );
  }
}

function syncUsersContextTopTabs(preferredTab = state.preferredTab) {
  const normalizedPreferredTab = String(preferredTab || "").trim().toLowerCase();
  const inUsersTab = normalizedPreferredTab === "users";
  const topTabs = Array.from(document.querySelectorAll(".tabs .tab"));
  topTabs.forEach((node) => {
    const id = String(node.id || "").trim();
    if (!id) return;
    if (inUsersTab) {
      if (id === "tab-users") {
        node.removeAttribute("data-users-context-hidden");
        node.classList.remove("hidden");
      } else {
        node.setAttribute("data-users-context-hidden", "1");
      }
      return;
    }
    if (node.getAttribute("data-users-context-hidden") === "1") {
      node.removeAttribute("data-users-context-hidden");
    }
  });
}

function ensureAssignmentHandoffLayoutOrder() {
  const root = qs("panel-assignments");
  const pageSummary = qs("assignment-page-summary");
  const listPanel = qs("assignment-list-panel");
  const createPanel = qs("assignment-manual-create-panel");
  const detailPanel = qs("assignment-detail-panel");
  if (!root || !listPanel || !createPanel) return;

  if (pageSummary && pageSummary.parentElement === root) {
    root.appendChild(pageSummary);
  }
  if (listPanel.parentElement === root) {
    root.appendChild(listPanel);
  }
  if (createPanel.parentElement === root) {
    root.appendChild(createPanel);
  }
  if (detailPanel && detailPanel.parentElement === root) {
    root.appendChild(detailPanel);
  }
}

function setUserManagementVisibility(visible) {
  qs("tab-users")?.classList.toggle("hidden", !visible);
  const panel = qs("panel-users");
  if (!panel) return;
  const isUsersTabActive = String(state.preferredTab || "").trim().toLowerCase() === "users";
  panel.classList.toggle("hidden", !(visible && isUsersTabActive));
  if (!visible || !isUsersTabActive) panel.classList.remove("active");
}

function getAllowedAssigneeRolesForAssignmentKind(targetKind = "") {
  const normalizedKind = String(targetKind || "").trim().toLowerCase();
  if (normalizedKind === "field") return ["freelance", "user", "admin", "owner"];
  if (normalizedKind === "editorial") return ["editor", "user", "admin", "owner"];
  return ["freelance", "editor", "user", "admin", "owner"];
}

function canAssignInternalWorkClient(assigneeRole = "", assigneeId = 0) {
  const normalizedAssigneeRole = String(assigneeRole || "").trim().toLowerCase();
  const normalizedCurrentRole = currentRole();
  const currentUserId = Number(state.user?.id || 0) || 0;
  const targetUserId = Number(assigneeId || 0) || 0;
  if (normalizedAssigneeRole !== "user" && normalizedAssigneeRole !== "admin" && normalizedAssigneeRole !== "owner") return true;
  if (!currentUserId || !targetUserId) return false;
  if (currentUserId === targetUserId) return true;
  if (normalizedCurrentRole === "user") return false;
  if (normalizedCurrentRole === "admin") return normalizedAssigneeRole === "user";
  if (normalizedCurrentRole === "owner") return normalizedAssigneeRole === "user" || normalizedAssigneeRole === "admin";
  return false;
}

function getAssignableUsers(targetKind = "", { restrictCreateInternalPolicy = false } = {}) {
  const visibleUsers = Array.isArray(state.visibleUsers) ? state.visibleUsers.slice() : [];
  const currentUserId = Number(state.user?.id || 0) || 0;
  const hasCurrentUser = currentUserId && visibleUsers.some((row) => Number(row?.id || 0) === currentUserId);
  if (currentUserId && !hasCurrentUser) {
    visibleUsers.push({
      id: currentUserId,
      email: String(state.user?.email || "").trim(),
      display_name: String(state.user?.display_name || "").trim(),
      role: String(state.user?.role || "").trim().toLowerCase(),
    });
  }
  const allowedRoles = getAllowedAssigneeRolesForAssignmentKind(targetKind);
  return visibleUsers.filter((row) => {
    const id = Number(row?.id || 0) || 0;
    const role = String(row?.role || "").trim().toLowerCase();
    if (!id || !allowedRoles.includes(role)) return false;
    if (restrictCreateInternalPolicy && !canAssignInternalWorkClient(role, id)) return false;
    return true;
  });
}

function getAssignmentCreateKind() {
  return String(qs("assignment-create-kind")?.value || "field").trim().toLowerCase() || "field";
}

function getSelectedAssignmentAssigneeUser() {
  const assigneeId = parsePositiveInt(qs("assignment-assignee-id")?.value, 0);
  if (!assigneeId) return null;
  return getAssignableUsers().find((row) => Number(row?.id || 0) === assigneeId) || null;
}

function renderAssignmentAssigneeSelectionSummary(secondaryText = "") {
  const summaryNode = qs("assignment-selected-summary");
  if (!summaryNode) return;
  const user = getSelectedAssignmentAssigneeUser();
  if (!user) {
    summaryNode.textContent = getAssignableUsers().length
      ? "เลือกผู้ลงงานแล้วกดโหลดงานในกระบวนการนี้"
      : "ยังไม่มี account ที่เลือกได้";
    return;
  }
  const label = String(user?.display_name || user?.email || `user #${Number(user?.id || 0)}`).trim();
  const avatarUrl = String(user?.avatar_url || "").trim();
  summaryNode.innerHTML = `
    <span class="assignment-inline-user">
      ${avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(label)}" class="assignment-inline-user-avatar" />`
        : '<span class="assignment-inline-user-avatar assignment-inline-user-avatar-placeholder" aria-hidden="true"></span>'}
      <span>${escapeHtml(label)}</span>
    </span>
    ${secondaryText ? `<span class="assignment-inline-user-note muted">${escapeHtml(secondaryText)}</span>` : ""}
  `;
}

function getManagerUsers(targetRole = "freelance") {
  const normalizedRole = String(targetRole || "").trim().toLowerCase();
  const managerRole = normalizedRole === "user" ? "admin" : "user";
  return (Array.isArray(state.visibleUsers) ? state.visibleUsers : []).filter(
    (row) => String(row?.role || "").toLowerCase() === managerRole
  );
}

function resolveManagerLabel(user) {
  const role = String(user?.role || "").toLowerCase();
  if (role !== "freelance" && role !== "editor" && role !== "user") {
    return "-";
  }
  const managedById = Number(user?.managed_by_user_id || 0) || 0;
  if (!managedById) {
    return "-";
  }
  const manager = getManagerUsers(role).find((row) => Number(row?.id || 0) === managedById);
  if (manager) {
    return [String(manager.display_name || "").trim(), String(manager.email || "").trim()].filter(Boolean).join(" | ") || `user #${managedById}`;
  }
  if (Number(state.user?.id || 0) === managedById) {
    return [String(state.user?.display_name || "").trim(), String(state.user?.email || "").trim()].filter(Boolean).join(" | ") || "คุณ";
  }
  return `user #${managedById}`;
}

function renderAssignmentAssigneeOptions() {
  const filterOptions = getAssignableUsers();
  const createOptions = getAssignableUsers(getAssignmentCreateKind(), { restrictCreateInternalPolicy: true });
  const filterNode = qs("assignment-assignee-id");
  const createNode = qs("assignment-create-assignee-id");

  const renderOptions = (node, options, { autoSelectSingle = false } = {}) => {
    if (!node) return;
    const current = String(node.value || "").trim();
    const placeholder = options.length ? "-- เลือกผู้รับงาน --" : "-- ยังไม่มี account ที่เลือกได้ --";
    node.innerHTML = [`<option value="">${placeholder}</option>`]
      .concat(
        options.map((row) => {
          const id = Number(row?.id || 0);
          const role = String(row?.role || "").trim().toLowerCase();
          const label = [
            String(row?.display_name || "").trim() || String(row?.email || "").trim() || `user #${id}`,
            role || null,
          ].filter(Boolean).join(" | ");
          return `<option value="${id}">${escapeHtml(label)}</option>`;
        })
      )
      .join("");
    node.disabled = options.length === 0;

    const hasCurrent = options.some((row) => String(Number(row?.id || 0)) === current);
    if (hasCurrent) {
      node.value = current;
    } else if (autoSelectSingle && options.length === 1) {
      node.value = String(Number(options[0]?.id || 0));
    } else {
      node.value = "";
    }
  };

  renderOptions(filterNode, filterOptions);
  renderOptions(createNode, createOptions, { autoSelectSingle: true });
  syncAssignmentCreateAssigneeMode();
}

function syncAssignmentCreateAssigneeMode() {
  const mode = String(qs("assignment-create-assignee-mode")?.value || "internal").trim().toLowerCase();
  const isExternal = mode === "external";
  const internalWrap = qs("assignment-create-assignee-internal-wrap");
  const externalWrap = qs("assignment-create-assignee-external-wrap");
  const contactWrap = qs("assignment-create-assignee-contact-wrap");
  const internalSelect = qs("assignment-create-assignee-id");
  const externalName = qs("assignment-create-assignee-name");
  const externalPhone = qs("assignment-create-assignee-phone");
  const externalEmail = qs("assignment-create-assignee-email");
  const externalLineId = qs("assignment-create-assignee-line-id");

  internalWrap?.classList.toggle("hidden", isExternal);
  externalWrap?.classList.toggle("hidden", !isExternal);
  contactWrap?.classList.toggle("hidden", !isExternal);
  if (internalSelect) internalSelect.disabled = isExternal || internalSelect.options.length <= 1;
  if (externalName) externalName.disabled = !isExternal;
  if (externalPhone) externalPhone.disabled = !isExternal;
  if (externalEmail) externalEmail.disabled = !isExternal;
  if (externalLineId) externalLineId.disabled = !isExternal;
}

function getSelectedAgentProfile() {
  const key = String(state.selectedAgentProfileKey || "field_pack_agent").trim().toLowerCase();
  return (state.agentProfiles || []).find((row) => String(row?.agent_key || "").trim().toLowerCase() === key)
    || (state.agentProfiles || [])[0]
    || null;
}

function renderAgentProfilePanel() {
  const panel = qs("agent-profile-panel");
  if (!panel) return;
  const visible = isOwnerUser();
  panel.classList.toggle("hidden", !visible);
  if (!visible) return;

  qs("agent-profile-body")?.classList.toggle("hidden", !state.agentProfilePanelOpen);
  const toggleBtn = qs("btn-agent-profile-toggle");
  if (toggleBtn) toggleBtn.textContent = state.agentProfilePanelOpen ? "ซ่อนตั้งค่า" : "เปิดตั้งค่า";
  if (!state.agentProfilePanelOpen) return;

  const select = qs("agent-profile-select");
  const textarea = qs("agent-profile-text");
  const summary = qs("agent-profile-status-summary");
  const profiles = Array.isArray(state.agentProfiles) ? state.agentProfiles : [];
  if (select) {
    select.innerHTML = profiles.length
      ? profiles.map((profile) => {
          const key = String(profile?.agent_key || "").trim();
          const label = String(profile?.display_name || key).trim() || key;
          const selected = key === state.selectedAgentProfileKey ? " selected" : "";
          return `<option value="${escapeHtml(key)}"${selected}>${escapeHtml(label)}</option>`;
        }).join("")
      : '<option value="field_pack_agent">Field Pack Agent</option>';
    if (!profiles.some((profile) => String(profile?.agent_key || "") === state.selectedAgentProfileKey) && profiles[0]?.agent_key) {
      state.selectedAgentProfileKey = String(profiles[0].agent_key || "field_pack_agent");
      select.value = state.selectedAgentProfileKey;
    }
  }

  const profile = getSelectedAgentProfile();
  if (textarea) textarea.value = String(profile?.profile_text ?? profile?.default_profile_text ?? "");
  if (summary) {
    const isDefault = profile?.is_default === true ? "ใช้ค่าเริ่มต้น" : "ปรับเอง";
    summary.value = profile ? `${isDefault}${profile.updated_at ? ` / ${profile.updated_at}` : ""}` : "ยังโหลดข้อมูลไม่ได้";
  }
}

async function loadAiFeaturePolicies() {
  if (!isOwnerUser()) throw new Error("owner เท่านั้นที่แก้ AI policy ได้");
  const result = await api("/api/ai-feature-policies");
  state.aiPolicyRows = Array.isArray(result?.items) ? result.items : [];
  state.aiPolicyCatalog = Array.isArray(result?.policy_catalog) ? result.policy_catalog : [];
  state.aiPolicyLoaded = true;
  state.aiPolicyError = "";
  renderAiPolicyPanel();
}

async function saveAiFeaturePolicy(featureKey, policyKey) {
  if (!isOwnerUser()) throw new Error("owner เท่านั้นที่แก้ AI policy ได้");
  const key = String(featureKey || "").trim();
  const nextPolicy = String(policyKey || "").trim();
  if (!key) throw new Error("feature key is required");
  if (!nextPolicy) throw new Error("policy key is required");
  const result = await api(`/api/ai-feature-policies/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ policy_key: nextPolicy }),
  });
  const item = result?.item || null;
  if (!item) throw new Error("Save AI policy failed");
  const idKey = String(item.feature_key || "").trim();
  state.aiPolicyRows = (Array.isArray(state.aiPolicyRows) ? state.aiPolicyRows : []).map((row) =>
    String(row?.feature_key || "").trim() === idKey ? item : row
  );
  state.aiPolicyLoaded = true;
  state.aiPolicyError = "";
  renderAiPolicyPanel();
}

function renderAiPolicyPanel() {
  const panel = qs("ai-policy-panel");
  if (!panel) return;
  const visible = isOwnerUser();
  panel.classList.toggle("hidden", !visible);
  if (!visible) return;
  qs("ai-policy-body")?.classList.toggle("hidden", !state.aiPolicyPanelOpen);
  const toggleBtn = qs("btn-ai-policy-toggle");
  if (toggleBtn) toggleBtn.textContent = state.aiPolicyPanelOpen ? "ซ่อนตั้งค่า" : "เปิดตั้งค่า";
  if (!state.aiPolicyPanelOpen) return;

  const table = qs("table-ai-policy");
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;
  const rows = Array.isArray(state.aiPolicyRows) ? state.aiPolicyRows : [];
  const catalog = Array.isArray(state.aiPolicyCatalog) ? state.aiPolicyCatalog : [];
  tbody.innerHTML = "";

  if (!state.aiPolicyLoaded) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="6" class="muted">กด "โหลดรายการ" เพื่อดึง AI feature policy ล่าสุด</td>';
    tbody.appendChild(tr);
    return;
  }

  if (state.aiPolicyError) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="muted">${escapeHtml(`โหลด AI feature policy ไม่สำเร็จ: ${state.aiPolicyError}`)}</td>`;
    tbody.appendChild(tr);
    return;
  }

  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="6" class="muted">ยังไม่มีข้อมูล AI policy</td>';
    tbody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const featureKey = String(row?.feature_key || "").trim();
    const selectedPolicy = String(row?.policy_key || "").trim();
    const disabled = row?.feature_active === false ? " disabled" : "";
    const options = catalog.map((policy) => {
      const policyKey = String(policy?.key || "").trim();
      const selected = policyKey === selectedPolicy ? " selected" : "";
      const label = String(policy?.label || policyKey).trim() || policyKey;
      return `<option value="${escapeHtml(policyKey)}"${selected}>${escapeHtml(label)}</option>`;
    }).join("");
    const statusText = row?.feature_active === false ? "reserved" : String(row?.feature_status || "active");
    const updatedText = String(row?.updated_at || "").trim() || "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(String(row?.feature_label || featureKey))}<div class="muted">${escapeHtml(featureKey)}</div></td>
      <td>${escapeHtml(String(row?.feature_description || "-"))}</td>
      <td><select data-ai-policy-feature="${escapeHtml(featureKey)}"${disabled}>${options}</select></td>
      <td>${escapeHtml(statusText)}</td>
      <td>${escapeHtml(updatedText)}</td>
      <td><button type="button" data-ai-policy-save="${escapeHtml(featureKey)}"${disabled}>บันทึก</button></td>
    `;
    tbody.appendChild(tr);
  }
}

function renderDataCleanupPanel() {
  const panel = qs("data-cleanup-panel");
  if (!panel) return;
  const visible = isOwnerUser();
  panel.classList.toggle("hidden", !visible);
  if (!visible) return;
  qs("data-cleanup-body")?.classList.toggle("hidden", !state.dataCleanupPanelOpen);
  const toggleBtn = qs("btn-data-cleanup-toggle");
  if (toggleBtn) toggleBtn.textContent = state.dataCleanupPanelOpen ? "ซ่อนตั้งค่า" : "เปิดตั้งค่า";
  if (!state.dataCleanupPanelOpen) return;

  const statusNode = qs("data-cleanup-status");
  const table = qs("table-data-cleanup");
  const tbody = table?.querySelector("tbody");
  const rows = Array.isArray(state.cleanup?.rows) ? state.cleanup.rows : [];
  const loaded = state.cleanup?.loaded === true;
  const lastError = String(state.cleanup?.lastError || "").trim();

  if (!tbody) return;
  tbody.innerHTML = "";

  if (lastError) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="muted">${escapeHtml(`โหลดรายการ cleanup ไม่สำเร็จ: ${lastError}`)}</td>`;
    tbody.appendChild(tr);
  } else if (!loaded) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="6" class="muted">กด "โหลดรายการ" เพื่อดึงรายการ soft delete ล่าสุด</td>';
    tbody.appendChild(tr);
  } else if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="6" class="muted">ยังไม่มีรายการ soft delete ที่พร้อม cleanup</td>';
    tbody.appendChild(tr);
  } else {
    rows.forEach((row) => {
      const blockers = Array.isArray(row?.blockers) ? row.blockers : [];
      const blockerText = blockers.length
        ? blockers.map((entry) => `${entry.label} (${Number(entry.count || 0) || 0})`).join(" | ")
        : "-";
      const canPurge = Boolean(row?.can_purge);
      const legacyWorkflowStatus = String(row?.legacy_workflow_status || "").trim();
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${Number(row?.id || 0) || "-"}</td>
        <td>${escapeHtml(String(row?.title || "").trim() || "-")}</td>
        <td>${escapeHtml(String(row?.category || "").trim() || "-")}</td>
        <td>${escapeHtml(legacyWorkflowStatus ? `legacy:${legacyWorkflowStatus}` : "-")}</td>
        <td>${escapeHtml(blockerText)}</td>
        <td class="action-stack">
          <button type="button" data-action="cleanup-check" data-id="${Number(row?.id || 0) || 0}">ตรวจ</button>
          <button type="button" data-action="cleanup-purge" data-id="${Number(row?.id || 0) || 0}"${canPurge ? "" : " disabled"}>Purge</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  if (statusNode) {
    const purgeable = rows.filter((row) => row?.can_purge).length;
    if (lastError) {
      statusNode.textContent = `โหลดไม่สำเร็จ: ${lastError}`;
      statusNode.style.color = "#b42318";
    } else if (!loaded) {
      statusNode.textContent = "ยังไม่ได้โหลดรายการ cleanup";
      statusNode.style.color = "";
    } else {
      statusNode.textContent = rows.length ? `พบ ${rows.length} รายการ | purge ได้ ${purgeable}` : "ยังไม่มีรายการให้ cleanup";
      statusNode.style.color = "";
    }
  }
}

function updateReferenceCleanupExecuteButton() {
  const btn = qs("btn-reference-cleanup-execute");
  if (!btn) return;
  const selectedCount = state.referenceCleanupSelectedGroups instanceof Set ? state.referenceCleanupSelectedGroups.size : 0;
  const hasItem = Number(state.referenceCleanupSelectedItemId || 0) > 0;
  btn.disabled = !hasItem || selectedCount < 1;
}

function renderReferenceCleanupPanel() {
  const panel = qs("reference-cleanup-panel");
  if (!panel) return;
  const visible = isOwnerUser();
  panel.classList.toggle("hidden", !visible);
  if (!visible) return;

  const body = qs("reference-cleanup-body");
  body?.classList.toggle("hidden", !state.referenceCleanupPanelOpen);
  const toggleBtn = qs("btn-reference-cleanup-toggle");
  if (toggleBtn) toggleBtn.textContent = state.referenceCleanupPanelOpen ? "ซ่อนตั้งค่า" : "เปิดตั้งค่า";
  if (!state.referenceCleanupPanelOpen) return;

  const items = Array.isArray(state.referenceCleanupDeletedItems) ? state.referenceCleanupDeletedItems : [];
  const selector = qs("reference-cleanup-item-id");
  if (selector) {
    if (!items.length) {
      selector.innerHTML = '<option value="">-</option>';
      state.referenceCleanupSelectedItemId = 0;
    } else {
      selector.innerHTML = items
        .map((row) => {
          const id = Number(row?.id || 0) || 0;
          const title = String(row?.title || "").trim() || "(ไม่มีชื่อ)";
          return `<option value="${id}">#${id} ${escapeHtml(title)}</option>`;
        })
        .join("");
      const hasSelected = items.some((row) => (Number(row?.id || 0) || 0) === Number(state.referenceCleanupSelectedItemId || 0));
      if (!hasSelected) {
        state.referenceCleanupSelectedItemId = Number(items[0]?.id || 0) || 0;
      }
      selector.value = String(state.referenceCleanupSelectedItemId || "");
    }
  }

  const refs = state.referenceCleanupReferences;
  const groups = Array.isArray(refs?.groups) ? refs.groups : [];
  const candidates = groups.filter((group) =>
    String(group?.category || "").trim().toLowerCase() === "cleanup_candidate"
    && REFERENCE_CLEANUP_CANDIDATE_KEYS.has(String(group?.key || "").trim().toLowerCase())
  );
  const blockers = groups.filter((group) => {
    const category = String(group?.category || "").trim().toLowerCase();
    const key = String(group?.key || "").trim().toLowerCase();
    if (category === "hard_blocker") return true;
    if (category === "cleanup_candidate" && !REFERENCE_CLEANUP_CANDIDATE_KEYS.has(key)) return true;
    return false;
  });

  const selected = new Set();
  for (const key of state.referenceCleanupSelectedGroups || []) {
    if (candidates.some((group) => String(group?.key || "").trim().toLowerCase() === key)) {
      selected.add(key);
    }
  }
  state.referenceCleanupSelectedGroups = selected;

  const candidatesNode = qs("reference-cleanup-candidates");
  if (candidatesNode) {
    if (!state.referenceCleanupSelectedItemId) {
      candidatesNode.innerHTML = '<div class="assignment-brief-empty">ยังไม่มีรายการ soft delete ให้เลือก</div>';
    } else if (!refs) {
      candidatesNode.innerHTML = '<div class="assignment-brief-empty">กด "โหลดข้อมูลอ้างอิง" เพื่อเริ่มตรวจ</div>';
    } else if (!candidates.length) {
      candidatesNode.innerHTML = '<div class="assignment-brief-empty">ไม่พบกลุ่มข้อมูลที่ล้างได้จากหน้านี้</div>';
    } else {
      candidatesNode.innerHTML = candidates.map((group) => {
        const key = String(group?.key || "").trim().toLowerCase();
        const count = Number(group?.count || 0) || 0;
        const label = String(group?.label_th || key).trim() || key;
        const checked = state.referenceCleanupSelectedGroups.has(key) ? " checked" : "";
        return `
          <label class="assignment-brief-text">
            <input type="checkbox" data-reference-cleanup-group="${escapeHtml(key)}"${checked} />
            ${escapeHtml(`${label} (${count})`)}
          </label>
        `;
      }).join("");
    }
  }

  const blockersNode = qs("reference-cleanup-blockers");
  if (blockersNode) {
    if (!state.referenceCleanupSelectedItemId) {
      blockersNode.innerHTML = '<div class="assignment-brief-empty">ยังไม่มีรายการ soft delete ให้เลือก</div>';
    } else if (!refs) {
      blockersNode.innerHTML = '<div class="assignment-brief-empty">ยังไม่ได้โหลดข้อมูล blocker</div>';
    } else if (!blockers.length) {
      blockersNode.innerHTML = '<div class="assignment-brief-empty">ไม่มี hard blocker</div>';
    } else {
      blockersNode.innerHTML = blockers.map((group) => {
        const key = String(group?.key || "").trim().toLowerCase();
        const count = Number(group?.count || 0) || 0;
        const label = String(group?.label_th || key).trim() || key;
        const hint = String(group?.resolution_hint || "ต้องจัดการผ่าน workflow ปกติก่อน").trim();
        return `<div class="assignment-brief-text">[LOCK] ${escapeHtml(`${label} (${count})`)} - ${escapeHtml(hint)}</div>`;
      }).join("");
    }
  }

  updateReferenceCleanupExecuteButton();
}

function applyCleanupRowsResponse(response, errorMessage = "") {
  state.cleanup = {
    rows: Array.isArray(response?.items) ? response.items : [],
    loaded: true,
    lastError: String(errorMessage || "").trim(),
  };
  state.referenceCleanupDeletedItems = Array.isArray(state.cleanup?.rows) ? state.cleanup.rows : [];
  if (!state.referenceCleanupDeletedItems.some((row) => (Number(row?.id || 0) || 0) === Number(state.referenceCleanupSelectedItemId || 0))) {
    state.referenceCleanupSelectedItemId = Number(state.referenceCleanupDeletedItems[0]?.id || 0) || 0;
    state.referenceCleanupReferences = null;
    state.referenceCleanupSelectedGroups = new Set();
  }
}

async function loadReferenceCleanupItems() {
  if (!isOwnerUser()) {
    state.referenceCleanupDeletedItems = [];
    state.referenceCleanupSelectedItemId = 0;
    state.referenceCleanupReferences = null;
    state.referenceCleanupSelectedGroups = new Set();
    renderReferenceCleanupPanel();
    return [];
  }

  let rows = Array.isArray(state.cleanup?.rows) ? state.cleanup.rows : [];
  if (!state.cleanup?.loaded) {
    rows = await loadDataCleanupRows();
  }
  state.referenceCleanupDeletedItems = Array.isArray(rows) ? rows : [];
  if (!state.referenceCleanupDeletedItems.some((row) => (Number(row?.id || 0) || 0) === Number(state.referenceCleanupSelectedItemId || 0))) {
    state.referenceCleanupSelectedItemId = Number(state.referenceCleanupDeletedItems[0]?.id || 0) || 0;
    state.referenceCleanupReferences = null;
    state.referenceCleanupSelectedGroups = new Set();
  }
  renderReferenceCleanupPanel();
  return state.referenceCleanupDeletedItems;
}

async function loadReferencesForItem(itemId) {
  if (!isOwnerUser()) throw new Error("owner เท่านั้นที่ใช้งาน Reference Cleanup ได้");
  const id = Number(itemId || 0) || 0;
  if (!id) throw new Error("กรุณาเลือกรายการก่อน");
  const response = await api(`/api/admin/deleted-items/${id}/references`);
  state.referenceCleanupSelectedItemId = id;
  state.referenceCleanupReferences = response || null;
  state.referenceCleanupSelectedGroups = new Set();
  renderReferenceCleanupPanel();
  return response;
}

async function executeReferenceCleanup() {
  if (!isOwnerUser()) throw new Error("owner เท่านั้นที่ใช้งาน Reference Cleanup ได้");
  const itemId = Number(state.referenceCleanupSelectedItemId || 0) || 0;
  if (!itemId) throw new Error("กรุณาเลือกรายการก่อน");
  const groups = Array.from(state.referenceCleanupSelectedGroups || []);
  if (!groups.length) throw new Error("กรุณาเลือกกลุ่มข้อมูลที่ต้องการล้าง");
  const reason = String(window.prompt("เหตุผลในการล้างข้อมูลอ้างอิง (ไม่บังคับ)", "") || "").trim();
  const result = await api(`/api/admin/deleted-items/${itemId}/references/cleanup`, {
    method: "POST",
    body: JSON.stringify({ groups, reason }),
  });
  await loadReferencesForItem(itemId);
  await loadDataCleanupRows();
  return result;
}

async function loadDataCleanupRows({ showSuccessStatus = false } = {}) {
  if (!canAccessSystemPage()) {
    state.cleanup = { rows: [], loaded: false, lastError: "" };
    renderDataCleanupPanel();
    return [];
  }
  try {
    const response = await api("/api/admin/deleted-items?limit=100");
    applyCleanupRowsResponse(response, "");
    renderDataCleanupPanel();
    renderReferenceCleanupPanel();
    if (showSuccessStatus) {
      const rows = Array.isArray(response?.items) ? response.items : [];
      const purgeable = rows.filter((row) => row?.can_purge).length;
      setStatus("data-cleanup-status", rows.length ? `โหลดแล้ว ${rows.length} รายการ | purge ได้ ${purgeable}` : "ยังไม่มีรายการให้ cleanup");
    }
    return Array.isArray(response?.items) ? response.items : [];
  } catch (err) {
    applyCleanupRowsResponse({ items: [] }, err?.message || "โหลดรายการ cleanup ไม่สำเร็จ");
    renderDataCleanupPanel();
    renderReferenceCleanupPanel();
    throw err;
  }
}

async function saveSelectedAgentProfile() {
  if (!isOwnerUser()) throw new Error("owner เท่านั้นที่แก้ Agent Profile ได้");
  const key = String(qs("agent-profile-select")?.value || state.selectedAgentProfileKey || "").trim().toLowerCase();
  const profileText = String(qs("agent-profile-text")?.value ?? "");
  if (!key) throw new Error("กรุณาเลือก Agent");
  const result = await api(`/api/agent-profiles/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ profile_text: profileText }),
  });
  const profile = result?.profile;
  state.agentProfiles = (state.agentProfiles || []).map((row) =>
    String(row?.agent_key || "").trim().toLowerCase() === key ? profile : row
  );
  if (!state.agentProfiles.some((row) => String(row?.agent_key || "").trim().toLowerCase() === key) && profile) {
    state.agentProfiles.push(profile);
  }
  renderAgentProfilePanel();
}

async function resetSelectedAgentProfile() {
  if (!isOwnerUser()) throw new Error("owner เท่านั้นที่ reset Agent Profile ได้");
  const key = String(qs("agent-profile-select")?.value || state.selectedAgentProfileKey || "").trim().toLowerCase();
  if (!key) throw new Error("กรุณาเลือก Agent");
  const result = await api(`/api/agent-profiles/${encodeURIComponent(key)}/reset`, {
    method: "POST",
  });
  const profile = result?.profile;
  state.agentProfiles = (state.agentProfiles || []).map((row) =>
    String(row?.agent_key || "").trim().toLowerCase() === key ? profile : row
  );
  if (!state.agentProfiles.some((row) => String(row?.agent_key || "").trim().toLowerCase() === key) && profile) {
    state.agentProfiles.push(profile);
  }
  renderAgentProfilePanel();
}

function updateUserManagementUI() {
  const title = qs("users-panel-title");
  const note = qs("users-panel-note");
  renderAgentProfilePanel();
  renderDataCleanupPanel();
  renderReferenceCleanupPanel();

  if (title) {
    title.textContent = "ระบบและผู้ใช้";
  }
  if (note) {
    note.textContent = "หน้ารวมจัดการผู้ใช้ในขอบเขต contributor management สำหรับ owner/admin/user โดยเครื่องมือ owner-only จะถูกซ่อนไว้เฉพาะ owner";
  }
}

function setRawVisibility(visible) {
  setPanelVisibility("tab-raw", "panel-raw", visible);
}

function setPlaceVisibility(visible) {
  qs("tab-place")?.classList.toggle("hidden", !visible);
  qs("panel-place")?.classList.add("hidden");
  qs("panel-place")?.classList.remove("active");
}

function setEventsVisibility(visible) {
  qs("tab-events")?.classList.toggle("hidden", !visible);
  qs("panel-events")?.classList.add("hidden");
  qs("panel-events")?.classList.remove("active");
}

function setTransportVisibility(visible) {
  qs("tab-transport")?.classList.toggle("hidden", !visible);
  qs("panel-transport")?.classList.add("hidden");
  qs("panel-transport")?.classList.remove("active");
}

function isExternalContributorUser() {
  const role = currentRole();
  return role === "freelance" || role === "editor";
}

function setAssignmentRoleVisibility() {
  const assigneeWrap = qs("assignment-assignee-wrap");
  const limitWrap = qs("assignment-limit-wrap");
  const reviewTrackingWrap = qs("assignment-review-tracking-wrap");
  const updateStateBtn = qs("btn-assignment-update-state");
  const createPanel = qs("assignment-manual-create-panel");
  const createBtn = qs("btn-assignment-create");
  const createSummary = qs("assignment-create-summary");
  const assignmentsTab = qs("tab-assignments");
  const handoffTab = qs("tab-handoff");
  const workTab = qs("tab-work");
  const reviewTab = qs("tab-review");
  const handoffMode = qs("assignment-mode-handoff");
  const workMode = qs("assignment-mode-work");
  const reviewMode = qs("assignment-mode-review");
  const pageMode = getAssignmentPageMode();
  const contextItemId = Number(state.assignments.contextItemId || getAssignmentLandingItemId() || 0) || 0;
  const contextFieldPackStatus = String(state.assignments.contextFieldPackStatus || "").trim().toLowerCase();
  const canCreateAssignment = canManageFreelanceAssignments();
  const isContextReady = isAssignmentContextReady(contextFieldPackStatus);
  const canSeeBaseTasks = canSeeAssignmentBaseTasksSurface();
  const canSeeCurrentWork = canSeeAssignmentCurrentWorkSurface();
  const canSeeExtendedManage = canSeeAssignmentExtendedManageSurface();
  const canSeeExtendedReview = canSeeAssignmentExtendedReviewSurface();
  const isWorkOnlyRole = isAssignmentWorkOnlyUser();
  const showCreatePanel = pageMode === "handoff" && contextItemId > 0 && canSeeExtendedManage;

  if (assigneeWrap) {
    assigneeWrap.classList.toggle("hidden", !canSeeExtendedManage || pageMode === "handoff" || pageMode === "work" || pageMode === "review");
  }
  if (limitWrap) {
    limitWrap.classList.toggle("hidden", !canSeeBaseTasks || pageMode === "handoff");
  }
  if (reviewTrackingWrap) {
    reviewTrackingWrap.classList.toggle("hidden", !(pageMode === "review" && canSeeExtendedReview && isOwnerUser()));
  }
  if (createPanel) {
    createPanel.classList.toggle("hidden", !showCreatePanel);
  }
  if (createBtn) {
    createBtn.disabled = !canSeeExtendedManage || !canCreateAssignment || !contextItemId || !isContextReady;
  }
  if (createSummary) {
    renderAssignmentCreateSummary();
  }
  renderAssignmentHandoffBrief();
  if (updateStateBtn) {
    updateStateBtn.disabled = !canPatchAssignmentState();
  }
  if (assignmentsTab) {
    assignmentsTab.classList.toggle("hidden", false);
  }
  if (handoffTab) {
    handoffTab.classList.add("hidden");
  }
  if (workTab) {
    workTab.classList.add("hidden");
  }
  if (reviewTab) {
    reviewTab.classList.add("hidden");
  }
  if (handoffMode) {
    handoffMode.classList.toggle("hidden", !canSeeExtendedManage);
  }
  if (workMode) {
    workMode.classList.toggle("hidden", !canSeeCurrentWork);
  }
  if (reviewMode) {
    reviewMode.classList.toggle("hidden", !canSeeExtendedReview);
  }
  updateAssignmentActionControls(getAssignmentById(state.assignments.selectedId));
  syncAssignmentPageMode(getAssignmentById(state.assignments.selectedId));
}

function syncAssignmentSubnav() {
  const pageMode = getAssignmentPageMode();
  document.querySelectorAll("[data-assignment-tab]").forEach((node) => {
    node.classList.toggle("active", String(node.getAttribute("data-assignment-tab") || "").trim().toLowerCase() === pageMode);
  });
}

function getAssignmentHandoffQueueItems(items = state.items) {
  const list = Array.isArray(items) ? items : [];
  return list
    .filter((item) => isHandoffEligibleItem(item))
    .sort((a, b) => {
      const aTime = Date.parse(String(a?.updated_at || a?.created_at || "").trim() || 0) || 0;
      const bTime = Date.parse(String(b?.updated_at || b?.created_at || "").trim() || 0) || 0;
      if (bTime !== aTime) return bTime - aTime;
      return (Number(b?.id || 0) || 0) - (Number(a?.id || 0) || 0);
    });
}

async function selectAssignmentContextItem(itemId, { syncUrl = true } = {}) {
  const targetItemId = parsePositiveInt(itemId, 0);
  if (!targetItemId || isExternalContributorUser()) return;
  state.assignments.contextItemId = targetItemId;
  if (syncUrl) {
    const params = new URLSearchParams(window.location.search);
    params.set("item_id", String(targetItemId));
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }
  await loadAssignmentContextFieldPackStatus(targetItemId);
  setAssignmentRoleVisibility();
  renderAssignmentsTable(state.assignments.rows);
}

async function loadAssignmentContextFieldPackStatus(itemId) {
  const targetItemId = parsePositiveInt(itemId, 0);
  if (!targetItemId) {
    state.assignments.contextFieldPackStatus = "";
    state.assignments.contextFieldPack = null;
    state.assignments.contextFieldPackLoadFailed = false;
    renderAssignmentHandoffBrief();
    renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(getAssignmentById(state.assignments.selectedId)));
    return "";
  }

  try {
    const response = await api(`/api/items/${targetItemId}/field-pack/current`);
    state.assignments.contextFieldPackStatus = String(response?.field_pack?.status || "").trim().toLowerCase();
    state.assignments.contextFieldPack = response?.field_pack && typeof response.field_pack === "object"
      ? response.field_pack
      : null;
    state.assignments.contextFieldPackLoadFailed = false;
  } catch {
    state.assignments.contextFieldPackStatus = "";
    state.assignments.contextFieldPack = null;
    state.assignments.contextFieldPackLoadFailed = true;
  }
  renderAssignmentHandoffBrief();
  renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(getAssignmentById(state.assignments.selectedId)));
  return state.assignments.contextFieldPackStatus;
}

async function loadAssignmentRequestedCheckHandoffSource(assignment = null) {
  if (isEditorUser()) return null;
  const assignmentId = Number(assignment?.id || 0) || 0;
  if (!assignmentId) return null;
  const inlineHandoffPackage = assignment?.handoff_package_json && typeof assignment.handoff_package_json === "object"
    ? assignment.handoff_package_json
    : null;
  if (inlineHandoffPackage) {
    state.assignments.handoffSourcePackages[assignmentId] = inlineHandoffPackage;
    state.assignments.handoffSourceSnapshotIds[assignmentId] = Number(assignment?.handoff_snapshot_id || 0) || null;
    state.assignments.handoffSourceLoaded[assignmentId] = true;
    rerenderAssignmentRequestedCheckSurfaces(assignmentId);
    return inlineHandoffPackage;
  }
  const loadState = state.assignments.handoffSourceLoaded?.[assignmentId];
  if (loadState === true) {
    return state.assignments.handoffSourcePackages?.[assignmentId] || null;
  }
  if (loadState === "loading") return null;
  state.assignments.handoffSourceLoaded[assignmentId] = "loading";
  try {
    const result = await api(`/api/assignments/${assignmentId}/handoff-source`);
    state.assignments.handoffSourcePackages[assignmentId] = result?.handoff?.handoff_package_json && typeof result.handoff.handoff_package_json === "object"
      ? result.handoff.handoff_package_json
      : null;
    state.assignments.handoffSourceSnapshotIds[assignmentId] = Number(result?.handoff?.id || 0) || null;
    state.assignments.handoffSourceLoaded[assignmentId] = true;
    rerenderAssignmentRequestedCheckSurfaces(assignmentId);
    return state.assignments.handoffSourcePackages[assignmentId] || null;
  } catch {
    state.assignments.handoffSourcePackages[assignmentId] = null;
    state.assignments.handoffSourceSnapshotIds[assignmentId] = null;
    state.assignments.handoffSourceLoaded[assignmentId] = false;
    return null;
  }
}

function resetAssignmentPreviews() {
  setJsonPreview("assignment-selected-json", null);
  setJsonPreview("assignment-submissions-json", []);
  setJsonPreview("assignment-evaluate-json", null);
  setJsonPreview("assignment-history-json", null);
}

function setAssignmentDetailVisible(visible) {
  qs("assignment-detail-panel")?.classList.toggle("hidden", !visible);
}

function setAssignmentProcessGuide(assignment) {
  const nextActionNode = qs("assignment-next-action");
  const stepsRoot = qs("assignment-process-steps");
  if (!nextActionNode || !stepsRoot) return;

  if (!assignment) {
    nextActionNode.textContent = ASSIGNMENT_PROCESS_DEFAULT.nextAction;
    stepsRoot.querySelectorAll(".step").forEach((node) => {
      node.classList.remove("completed", "active");
    });
    return;
  }

  const stateValue = String(assignment.state || "").trim().toLowerCase();
  const guide = ASSIGNMENT_PROCESS_GUIDE[stateValue] || {
    step: 2,
    nextAction: `สถานะปัจจุบัน: ${stateValue || "unknown"} (ตรวจสอบแล้วดำเนินขั้นถัดไปตาม workflow)`,
  };
  nextActionNode.textContent = guide.nextAction;

  stepsRoot.querySelectorAll(".step").forEach((node) => {
    const stepNumber = Number(node.dataset.step || 0);
    node.classList.remove("completed", "active");
    if (!stepNumber) return;
    if (stepNumber < guide.step) {
      node.classList.add("completed");
      return;
    }
    if (stepNumber === guide.step) {
      node.classList.add("active");
    }
  });
}

function getAssignmentWorkspaceLayout(assignment) {
  const stateValue = String(assignment?.state || "").trim().toLowerCase();
  if (stateValue === "revision_requested") {
    return {
      stateTitle: "ขั้นที่ 2: ลงงาน",
      stateHelp: "ขั้นนี้จบไปแล้วในรอบก่อน ตอนนี้ให้กลับมาลงงานและส่งกลับอีกครั้ง",
      submissionTitle: "งานที่ส่งกลับมาก่อนหน้า",
      submissionHelp: "ใช้ส่วนนี้ดูงานส่งรอบก่อนและคอมเมนต์ล่าสุด เพื่อกลับไปแก้และส่งกลับอีกครั้ง",
      reviewTitle: "ขั้นที่ 3: ตรวจงาน",
      reviewHelp: "ผลตรวจรอบล่าสุดยังไม่ผ่าน ให้ใช้คอมเมนต์ชุดนี้เป็นโจทย์สำหรับการกลับไปแก้แล้วส่งงานกลับ",
      stateMode: "hidden",
      submissionMode: "active",
      reviewMode: "collapsed",
      nextTitle: "ขั้นถัดไป",
      nextBody: "หลังส่งงานกลับแล้ว ระบบจะกลับไปรอตรวจงานอีกครั้งในขั้นที่ 3",
    };
  }
  if (stateValue === "submitted" || stateValue === "resubmitted") {
    return {
      stateTitle: "ขั้นที่ 2: ลงงาน",
      stateHelp: "ขั้นนี้เสร็จแล้วในรอบปัจจุบัน จึงเหลือให้ผู้ดูแลงานตรวจงานต่อ",
      submissionTitle: "งานที่ส่งกลับมา",
      submissionHelp: "ใช้ส่วนนี้ดูงานส่งของรอบล่าสุดก่อนตัดสินใจขอแก้เพิ่มหรือรับงานผ่าน",
      reviewTitle: "ขั้นที่ 3: ตรวจงาน",
      reviewHelp: "ใช้ส่วนนี้สำหรับตรวจงานที่ส่งกลับมา และตัดสินใจรับงานหรือขอแก้เพิ่มในขั้นนี้",
      stateMode: "hidden",
      submissionMode: "collapsed",
      reviewMode: "active",
      nextTitle: "ขั้นถัดไป",
      nextBody: "ตรวจงานในขั้นที่ 3 แล้วเลือกว่าจะรับงานหรือขอแก้เพิ่ม",
    };
  }
  if (stateValue === "accepted" || stateValue === "closed") {
    return {
      stateTitle: "เสร็จแล้ว",
      stateHelp: "งานนี้เสร็จแล้วหลังการตรวจรับผ่าน",
      submissionTitle: "งานที่ส่งกลับมา",
      submissionHelp: "งานส่งของรอบล่าสุดถูกเก็บไว้เป็นข้อมูลอ้างอิงของงานนี้",
      reviewTitle: "ขั้นที่ 3: ตรวจงาน",
      reviewHelp: "ผลการตรวจรับของรอบล่าสุดแสดงไว้เป็นสรุปว่ากระบวนการนี้เสร็จแล้ว",
      stateMode: "hidden",
      submissionMode: "collapsed",
      reviewMode: "collapsed",
      nextTitle: "สถานะงาน",
      nextBody: "งานนี้เสร็จแล้วหลังการตรวจรับผ่าน",
    };
  }
  if (stateValue === "assigned") {
    return {
      stateTitle: "ขั้นที่ 2: ลงงาน",
      stateHelp: "ใช้ส่วนนี้เพื่อเริ่มลงงานและอัปเดตสถานะระหว่างปฏิบัติงาน",
      submissionTitle: "ขั้นที่ 2: ลงงาน",
      submissionHelp: "ส่วนนี้จะใช้งานเมื่อจบหน้างานและพร้อมส่งข้อมูลกลับเพื่อตรวจงาน",
      reviewTitle: "ขั้นที่ 3: ตรวจงาน",
      reviewHelp: "ส่วนนี้จะใช้งานหลังจากมีการส่งข้อมูลกลับแล้ว",
      stateMode: "active",
      submissionMode: "collapsed",
      reviewMode: "hidden",
      nextTitle: "ขั้นถัดไป",
      nextBody: "รับงานแล้วเริ่มลงงานในขั้นที่ 2 จากนั้นค่อยส่งกลับมาเพื่อตรวจงานในขั้นที่ 3",
    };
  }
  return {
    stateTitle: "ขั้นที่ 2: ลงงาน",
    stateHelp: "ใช้ส่วนนี้สำหรับอัปเดตสถานะงานระหว่างลงงาน",
    submissionTitle: "ขั้นที่ 2: ลงงาน",
    submissionHelp: "เมื่อจบหน้างานแล้ว ให้ส่งข้อมูลกลับและแนบงานส่งของรอบล่าสุดจากส่วนนี้",
    reviewTitle: "ขั้นที่ 3: ตรวจงาน",
    reviewHelp: "ส่วนนี้จะใช้งานหลังจากมีการส่งข้อมูลกลับแล้ว",
    stateMode: "active",
    submissionMode: "collapsed",
    reviewMode: "hidden",
    nextTitle: "ขั้นถัดไป",
    nextBody: "เมื่อจบหน้างานแล้ว ให้ส่งกลับมาเพื่อตรวจงานในขั้นที่ 3",
  };
}

function formatAssignmentWorkspaceUpdatedAt(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString("sv-SE", {
    timeZone: "Asia/Bangkok",
    hour12: false,
  }).replace("T", " ");
}

function canActOnAssignmentWork(assignment) {
  const row = assignment && typeof assignment === "object" ? assignment : null;
  if (!row) return false;
  const currentUserId = Number(state.user?.id || 0) || 0;
  if (!currentUserId) return false;
  const assigneeUserId = Number(row.assignee_user_id || 0) || 0;
  if (assigneeUserId > 0) {
    return assigneeUserId === currentUserId;
  }
  const assignedByUserId = Number(row.assigned_by_user_id || 0) || 0;
  return assignedByUserId > 0 && assignedByUserId === currentUserId;
}

function isAssignmentTrackOnlySelection(assignment) {
  const row = assignment && typeof assignment === "object" ? assignment : null;
  if (!row || getAssignmentPageMode() !== "work") return false;
  const selectedTrackOnlyId = Number(state.assignments.trackOnlySelectionId || 0) || 0;
  const assignmentId = Number(row.id || 0) || 0;
  return selectedTrackOnlyId > 0 && assignmentId === selectedTrackOnlyId;
}

function isAssignmentSubmittedSelection(assignment) {
  const row = assignment && typeof assignment === "object" ? assignment : null;
  if (!row || getAssignmentPageMode() !== "work") return false;
  const selectedSubmittedId = Number(state.assignments.submittedSelectionId || 0) || 0;
  const assignmentId = Number(row.id || 0) || 0;
  return selectedSubmittedId > 0 && assignmentId === selectedSubmittedId;
}

function isAssignmentReadOnlyWorkSelection(assignment) {
  return isAssignmentTrackOnlySelection(assignment) || isAssignmentSubmittedSelection(assignment);
}

function getAssignmentSubmissionFormAssignment(assignment, pageMode = getAssignmentPageMode()) {
  const row = assignment && typeof assignment === "object" ? assignment : null;
  if (!row) return null;
  return pageMode === "work" && (!canActOnAssignmentWork(row) || isAssignmentReadOnlyWorkSelection(row)) ? null : row;
}

function renderAssignmentWorkMonitor(assignment) {
  const wrap = qs("assignment-work-monitor");
  const summaryNode = qs("assignment-work-monitor-summary");
  const noteNode = qs("assignment-work-monitor-note");
  const briefLink = qs("assignment-work-monitor-brief-link");
  if (!wrap || !summaryNode || !noteNode || !briefLink) return;
  const itemId = Number(assignment?.content_item_id || state.assignments.contextItemId || 0) || 0;
  const isTrackOnly = isAssignmentTrackOnlySelection(assignment);
  const isSubmittedView = isAssignmentSubmittedSelection(assignment);
  if (!assignment || (!isTrackOnly && !isSubmittedView && canActOnAssignmentWork(assignment))) {
    wrap.classList.add("hidden");
    summaryNode.innerHTML = '<div class="assignment-brief-empty">เลือกงานมอบหมายเพื่อดูข้อมูลติดตามงาน</div>';
    noteNode.textContent = "step นี้ใช้สำหรับผู้รับงานที่กำลังลงงานอยู่";
  } else {
    wrap.classList.remove("hidden");
    summaryNode.innerHTML = `
      <div class="assignment-brief-section">
        <div class="assignment-brief-label">ผู้รับงาน</div>
        <div class="assignment-brief-text">${escapeHtml(getAssignmentAssigneeLabel(assignment))}</div>
      </div>
      <div class="assignment-brief-section">
        <div class="assignment-brief-label">สถานะงาน</div>
        <div class="assignment-brief-text">${escapeHtml(String(assignment.state || "-").trim() || "-")}</div>
      </div>
      <div class="assignment-brief-section">
        <div class="assignment-brief-label">กำหนดส่ง</div>
        <div class="assignment-brief-text">${escapeHtml(formatAssignmentDueAtLabel(assignment.due_at))}</div>
      </div>
      <div class="assignment-brief-section">
        <div class="assignment-brief-label">รายการ</div>
        <div class="assignment-brief-text">item #${escapeHtml(String(Number(assignment.content_item_id || 0) || "-"))}</div>
      </div>
    `;
    noteNode.textContent = isSubmittedView
      ? "งานนี้ส่งกลับเข้าระบบแล้ว และกำลังรอตรวจจากฝั่งภายใน"
      : `งานนี้ถูกมอบหมายให้ ${getAssignmentAssigneeLabel(assignment)} เป็นผู้ลงงานในขั้นนี้`;
  }
  briefLink.href = buildAssignmentBriefUrl(itemId, Number(assignment?.id || 0) || 0);
  briefLink.classList.toggle("disabled", !(itemId > 0));
  if (itemId > 0) {
    briefLink.removeAttribute("aria-disabled");
  } else {
    briefLink.setAttribute("aria-disabled", "true");
  }
}

function resolveAssignmentReviewMediaUrl(item) {
  const directUrl = String(item?.public_url || item?.source_url || "").trim();
  if (directUrl) return directUrl;
  const sourceAssetId = Number(item?.source_asset_id || 0) || 0;
  if (!sourceAssetId) return "";
  const asset = findAssignmentAssetById(sourceAssetId);
  return String(asset?.public_url || "").trim();
}

function summarizeAssignmentReviewMediaLabel(item, fallbackPrefix) {
  const title = String(item?.title || "").trim();
  if (title) return title;
  const sourceAssetId = Number(item?.source_asset_id || 0) || 0;
  if (sourceAssetId) {
    const asset = findAssignmentAssetById(sourceAssetId);
    if (asset) return summarizeAssignmentAssetOption(asset);
    return `asset #${sourceAssetId}`;
  }
  const sourceUrl = String(item?.source_url || "").trim();
  if (sourceUrl) {
    try {
      return new URL(sourceUrl, window.location.origin).pathname.split("/").pop() || sourceUrl;
    } catch {
      return sourceUrl;
    }
  }
  return fallbackPrefix;
}

function getAssignmentReviewMediaItems(assignment, deliverableType) {
  const bundle = state.assignments.deliverablesBundle && typeof state.assignments.deliverablesBundle === "object"
    ? state.assignments.deliverablesBundle
    : null;
  const type = String(deliverableType || "").trim().toLowerCase();
  const fromBundle = Array.isArray(bundle?.deliverables_by_type?.[type])
    ? bundle.deliverables_by_type[type]
      .map((row, index) => ({
        key: `deliverable-${type}-${Number(row?.id || 0) || index}`,
        url: resolveAssignmentReviewMediaUrl(row),
        label: summarizeAssignmentReviewMediaLabel(row, `${getAssignmentDeliverableLabel(type)} ${index + 1}`),
        meta: row?.created_at || row?.updated_at || "",
      }))
      .filter((row) => row.url)
    : [];
  if (fromBundle.length) return fromBundle;

  const latestSubmission = getLatestAssignmentSubmissionRow(assignment);
  const payloadAssets = Array.isArray(latestSubmission?.media_payload_json?.assets)
    ? latestSubmission.media_payload_json.assets
    : [];
  const mimePrefix = type === "videos" ? "video/" : "image/";
  return payloadAssets
    .filter((asset) => String(asset?.mime_type || "").trim().toLowerCase().startsWith(mimePrefix))
    .map((asset, index) => ({
      key: `payload-${type}-${Number(asset?.id || 0) || index}`,
      url: String(asset?.public_url || "").trim(),
      label: String(asset?.file_name || "").trim() || `${getAssignmentDeliverableLabel(type)} ${index + 1}`,
      meta: String(asset?.mime_type || "").trim(),
    }))
    .filter((row) => row.url);
}

function getAssignmentReviewTextDeliverables() {
  const bundle = state.assignments.deliverablesBundle && typeof state.assignments.deliverablesBundle === "object"
    ? state.assignments.deliverablesBundle
    : null;
  const groups = bundle?.text_like_deliverables?.deliverables_by_type && typeof bundle.text_like_deliverables.deliverables_by_type === "object"
    ? bundle.text_like_deliverables.deliverables_by_type
    : {};
  const rows = [];
  Object.entries(groups).forEach(([type, list]) => {
    (Array.isArray(list) ? list : []).forEach((row, index) => {
      const textContent = String(row?.text_content || "").trim();
      const sourceUrl = String(row?.source_url || "").trim();
      if (!textContent && !sourceUrl) return;
      rows.push({
        key: `text-deliverable-${String(type)}-${Number(row?.id || 0) || index}`,
        label: getAssignmentDeliverableLabel(type),
        title: String(row?.title || "").trim(),
        text: textContent,
        source_url: sourceUrl,
      });
    });
  });
  return rows;
}

function getAssignmentReviewRequestedCheckFallbackLabel(returnKey) {
  const key = String(returnKey || "").trim().toLowerCase();
  if (!key) return "";
  const parts = key.split(".");
  return String(parts[parts.length - 1] || "")
    .replace(/_/g, " ")
    .trim() || key;
}

function getAssignmentReviewRequestedCheckSafeUrl(value) {
  const rawUrl = String(value == null ? "" : value).trim();
  if (!rawUrl) return "";
  try {
    const baseOrigin = typeof window !== "undefined" && window?.location?.origin
      ? window.location.origin
      : "http://localhost";
    const parsed = new URL(rawUrl, baseOrigin);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function formatAssignmentReviewRequestedCheckValueHtml(row = {}, check = null) {
  const answerType = String(check?.answer_type || row?.answer_type || "").trim().toLowerCase() || "text";
  const checked = row?.checked === true;
  if (!checked) {
    return '<span class="muted">ไม่ได้รายงาน</span>';
  }
  if (row?.found === false) {
    return '<span class="muted">ไม่พบ</span>';
  }

  const value = row?.value;
  if (answerType === "boolean" || answerType === "boolean_with_conditions") {
    if (value === true) return "<span>มี</span>";
    if (value === false) return "<span>ไม่มี</span>";
    return '<span class="muted">ไม่ได้รายงาน</span>';
  }

  if (answerType === "number_with_unit") {
    const numberValue = value && typeof value === "object" && !Array.isArray(value)
      ? value.number
      : value;
    const unitValue = value && typeof value === "object" && !Array.isArray(value)
      ? value.unit
      : "";
    const numberText = numberValue == null ? "" : String(numberValue).trim();
    const unitText = String(unitValue == null ? "" : unitValue).trim();
    const combined = [numberText, unitText].filter(Boolean).join(" ");
    return combined ? `<span>${escapeHtml(combined)}</span>` : '<span class="muted">ไม่ได้รายงาน</span>';
  }

  if (answerType === "multi_select") {
    const items = Array.isArray(value)
      ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    return items.length
      ? `<span>${items.map((item) => escapeHtml(item)).join(", ")}</span>`
      : '<span class="muted">ไม่ได้รายงาน</span>';
  }

  const text = answerType === "url" || answerType === "phone"
    ? String(value == null ? "" : value).trim()
    : formatRequestedCheckSuggestedValue(value, answerType).trim();
  if (!text) return '<span class="muted">ไม่ได้รายงาน</span>';
  const safeUrl = answerType === "url" ? getAssignmentReviewRequestedCheckSafeUrl(text) : "";
  if (safeUrl) {
    return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
  }
  return `<span>${escapeHtml(text)}</span>`;
}

function buildAssignmentReviewRequestedCheckRowHtml(check = {}, row = {}) {
  const label = String(check?.label || row?.label || getAssignmentReviewRequestedCheckFallbackLabel(check?.return_key || row?.return_key || "")).trim();
  const conditionNote = String(row?.condition_note || "").trim();
  const note = String(row?.note || "").trim();
  const valueHtml = formatAssignmentReviewRequestedCheckValueHtml(row, check);
  const metaItems = [];
  if (conditionNote) metaItems.push(`เงื่อนไข: ${escapeHtml(conditionNote)}`);
  if (note) metaItems.push(`หมายเหตุ: ${escapeHtml(note)}`);
  return `
    <div class="assignment-review-answer-item" data-requested-check-return-key="${escapeHtml(String(check?.return_key || row?.return_key || ""))}">
      <div class="assignment-review-answer-prompt">${escapeHtml(label || "-")}</div>
      <div class="assignment-review-answer-text">${valueHtml}</div>
      ${metaItems.length ? `<div class="assignment-review-answer-meta">${metaItems.join(" · ")}</div>` : ""}
    </div>
  `;
}

function buildAssignmentReviewRequestedCheckRowsForGroup(groupKey, requestedCheckReturns = {}, handoffGroup = null) {
  const normalizedGroupKey = String(groupKey || "").trim().toLowerCase();
  const rows = [];
  const groupChecks = Array.isArray(handoffGroup?.checks) ? handoffGroup.checks : [];
  if (groupChecks.length) {
    if (normalizedGroupKey === "taxonomy") {
      const primaryRows = [];
      const additionalRows = [];
      groupChecks.forEach((check) => {
        const returnKey = String(check?.return_key || "").trim().toLowerCase();
        if (!returnKey) return;
        const row = requestedCheckReturns?.[returnKey];
        if (!row) return;
        if (!isAssignmentCurationRenderableCheck(check)) return;
        const placement = resolveAssignmentCurationCheckPlacement(check, row);
        if (placement === "hidden") return;
        const entry = { check, row };
        if (placement === "primary") primaryRows.push(entry);
        else additionalRows.push(entry);
      });
      return [...primaryRows, ...additionalRows];
    }

    groupChecks.forEach((check) => {
      const returnKey = String(check?.return_key || "").trim().toLowerCase();
      if (!returnKey) return;
      const row = requestedCheckReturns?.[returnKey];
      if (!row) return;
      rows.push({ check, row });
    });
    return rows;
  }

  Object.entries(requestedCheckReturns || {}).forEach(([rawKey, row]) => {
    const returnKey = String(rawKey || "").trim().toLowerCase();
    if (!returnKey.startsWith(`${normalizedGroupKey}.`)) return;
    if (!row || typeof row !== "object" || Array.isArray(row)) return;
    const checkKey = returnKey.slice(normalizedGroupKey.length + 1).trim().toLowerCase();
    if (!checkKey) return;
    if (normalizedGroupKey === "taxonomy" && !isAssignmentCurationRenderableCheck({ group_key: "taxonomy", check_key: checkKey })) {
      return;
    }
    rows.push({
      check: {
        group_key: normalizedGroupKey,
        group_label: normalizedGroupKey === "cta_contact" ? "CTA/ติดต่อ" : "Curation",
        check_key: checkKey,
        return_key: returnKey,
        label: getAssignmentReviewRequestedCheckFallbackLabel(returnKey),
        answer_type: String(row?.answer_type || "text").trim().toLowerCase() || "text",
      },
      row,
    });
  });
  return rows;
}

function buildAssignmentReviewRequestedCheckCardsHtml(assignment = null) {
  const assignmentId = Number(assignment?.id || 0) || 0;
  if (!assignmentId) return "";
  const latestSubmission = getLatestAssignmentSubmissionRow(assignment);
  const requestedCheckReturns = latestSubmission?.field_return_payload_json?.requested_check_returns;
  if (!requestedCheckReturns || typeof requestedCheckReturns !== "object" || Array.isArray(requestedCheckReturns)) {
    return "";
  }

  const handoffPackage = state.assignments.handoffSourcePackages?.[assignmentId] || null;
  const handoffGroups = getAssignmentRequestedCheckGroupsFromHandoffPackage(handoffPackage);
  const handoffGroupMap = new Map(handoffGroups.map((group) => [group.group_key, group]));
  const cards = [];

  const ctaRows = buildAssignmentReviewRequestedCheckRowsForGroup("cta_contact", requestedCheckReturns, handoffGroupMap.get("cta_contact") || null);
  if (ctaRows.length) {
    const ctaLabel = String(handoffGroupMap.get("cta_contact")?.group_label || "CTA/ติดต่อ").trim() || "CTA/ติดต่อ";
    cards.push(`
      <div class="assignment-review-submission-section full-span assignment-review-requested-check-card" data-review-requested-check-group="cta_contact">
        <div class="assignment-brief-label">${escapeHtml(ctaLabel)}</div>
        <div class="assignment-review-answer-block">
          ${ctaRows.map(({ check, row }) => buildAssignmentReviewRequestedCheckRowHtml(check, row)).join("")}
        </div>
      </div>
    `);
  }

  const taxonomyRows = buildAssignmentReviewRequestedCheckRowsForGroup("taxonomy", requestedCheckReturns, handoffGroupMap.get("taxonomy") || null);
  if (taxonomyRows.length) {
    cards.push(`
      <div class="assignment-review-submission-section full-span assignment-review-requested-check-card" data-review-requested-check-group="taxonomy">
        <div class="assignment-brief-label">Curation</div>
        <div class="assignment-review-answer-block">
          ${taxonomyRows.map(({ check, row }) => buildAssignmentReviewRequestedCheckRowHtml(check, row)).join("")}
        </div>
      </div>
    `);
  }

  return cards.join("");
}

function hideAssignmentReviewHoverPreview() {
  const preview = qs("assignment-review-hover-preview");
  const image = qs("assignment-review-hover-preview-image");
  if (!preview || !image) return;
  preview.classList.add("hidden");
  image.removeAttribute("src");
}

function positionAssignmentReviewHoverPreview(event) {
  const preview = qs("assignment-review-hover-preview");
  if (!preview || !event) return;
  const maxLeft = Math.max(12, window.innerWidth - preview.offsetWidth - 16);
  const maxTop = Math.max(12, window.innerHeight - preview.offsetHeight - 16);
  const left = Math.max(12, Math.min(Number(event.clientX || 0) + 20, maxLeft));
  const top = Math.max(12, Math.min(Number(event.clientY || 0) + 20, maxTop));
  preview.style.transform = `translate(${left}px, ${top}px)`;
}

function showAssignmentReviewHoverPreview(url, event) {
  const preview = qs("assignment-review-hover-preview");
  const image = qs("assignment-review-hover-preview-image");
  if (!preview || !image || !url) return;
  image.src = url;
  preview.classList.remove("hidden");
  positionAssignmentReviewHoverPreview(event);
}

function renderAssignmentReviewSubmissionContent(assignment) {
  const card = qs("assignment-review-submission-card");
  const contentNode = qs("assignment-review-submission-content");
  const textNode = qs("assignment-review-submission-text");
  const photosNode = qs("assignment-review-submission-photos");
  const videosNode = qs("assignment-review-submission-videos");
  const pageMode = getAssignmentPageMode();
  if (!card || !contentNode || !textNode || !photosNode || !videosNode) return;

  const shouldShow = pageMode === "review" && Boolean(assignment);
  card.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    const requestedCheckCardsNode = contentNode.querySelector ? contentNode.querySelector("#assignment-review-requested-check-cards") : null;
    if (requestedCheckCardsNode) requestedCheckCardsNode.remove();
    textNode.className = "assignment-brief-empty";
    textNode.innerHTML = "เลือกงานมอบหมายเพื่อดูข้อความที่ผู้ลงงานส่งกลับ";
    photosNode.className = "assignment-brief-empty";
    photosNode.innerHTML = "ยังไม่มีรูปที่ส่งกลับล่าสุด";
    videosNode.className = "assignment-brief-empty";
    videosNode.innerHTML = "ยังไม่มีวิดีโอที่ส่งกลับล่าสุด";
    hideAssignmentReviewHoverPreview();
    return;
  }

  const existingRequestedCheckCardsNode = contentNode.querySelector ? contentNode.querySelector("#assignment-review-requested-check-cards") : null;
  if (existingRequestedCheckCardsNode) {
    existingRequestedCheckCardsNode.remove();
  }

  const sections = buildAssignmentReviewTextSections(assignment);
  const textDeliverables = getAssignmentReviewTextDeliverables();
  const textHtml = sections.map((section) => {
    const items = Array.isArray(section?.items) ? section.items.filter((row) => row.answer) : [];
    const textValue = String(section?.text || "").trim();
    const body = items.length
      ? items.map((item) => `
        <div class="assignment-review-answer-item">
          <div class="assignment-review-answer-prompt">${escapeHtml(item.prompt || "-")}</div>
          <div class="assignment-review-answer-text">${escapeHtml(item.answer || "-")}</div>
        </div>
      `).join("")
      : textValue
        ? `<div class="assignment-review-answer-item"><div class="assignment-review-answer-text">${escapeHtml(textValue)}</div></div>`
        : '<div class="assignment-brief-empty">ยังไม่มีข้อมูลในส่วนนี้</div>';
    return `
      <div class="assignment-review-answer-group">
        <div class="assignment-review-answer-group-title">${escapeHtml(section?.label || "-")}</div>
        ${body}
      </div>
    `;
  }).join("");
  textNode.className = "assignment-review-submission-section full-span";
  textNode.innerHTML = `
    <div class="assignment-brief-label">ข้อความที่ผู้ลงงานส่งกลับ</div>
    <div class="assignment-review-answer-block">
      ${textHtml || '<div class="assignment-brief-empty">ยังไม่มีข้อความที่ส่งกลับล่าสุด</div>'}
      ${textDeliverables.length ? `
        <div class="assignment-review-answer-group">
          <div class="assignment-review-answer-group-title">ข้อความแนบล่าสุด</div>
          ${textDeliverables.map((row) => `
            <div class="assignment-review-answer-item">
              <div class="assignment-review-answer-prompt">${escapeHtml(row.title || row.label)}</div>
              <div class="assignment-review-answer-text">${row.text ? escapeHtml(row.text) : (row.source_url ? `<a href="${escapeHtml(row.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.source_url)}</a>` : "-")}</div>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;

  const requestedCheckCardsHtml = buildAssignmentReviewRequestedCheckCardsHtml(assignment);
  if (requestedCheckCardsHtml) {
    contentNode.insertAdjacentHTML("beforeend", `
      <div id="assignment-review-requested-check-cards" class="assignment-review-requested-checks">
        ${requestedCheckCardsHtml}
      </div>
    `);
  }

  const photoItems = getAssignmentReviewMediaItems(assignment, "photos");
  photosNode.className = "assignment-review-submission-section";
  photosNode.innerHTML = photoItems.length
    ? `
      <div class="assignment-brief-label">รูปที่ส่งกลับล่าสุด</div>
      <div class="assignment-review-media-grid">
        ${photoItems.map((item) => `
          <div class="assignment-review-photo-thumb" data-review-photo-url="${escapeHtml(item.url)}">
            <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.label)}" loading="lazy" />
            <div class="assignment-review-photo-thumb-label">${escapeHtml(item.label)}</div>
          </div>
        `).join("")}
      </div>
    `
    : `
      <div class="assignment-brief-label">รูปที่ส่งกลับล่าสุด</div>
      <div class="assignment-brief-empty">ยังไม่มีรูปที่ส่งกลับล่าสุด</div>
    `;

  const videoItems = getAssignmentReviewMediaItems(assignment, "videos");
  if (!videoItems.length) {
    state.assignments.reviewSelectedVideoKey = "";
  }
  const selectedVideo = videoItems.find((item) => item.key === state.assignments.reviewSelectedVideoKey) || videoItems[0] || null;
  state.assignments.reviewSelectedVideoKey = selectedVideo?.key || "";
  videosNode.className = "assignment-review-submission-section";
  videosNode.innerHTML = selectedVideo
    ? `
      <div class="assignment-brief-label">วิดีโอที่ส่งกลับล่าสุด</div>
      <div class="assignment-review-video-layout">
        <div class="assignment-review-video-player">
          <video controls preload="metadata" src="${escapeHtml(selectedVideo.url)}"></video>
          <div class="assignment-review-video-meta">
            <div>${escapeHtml(selectedVideo.label)}</div>
            ${selectedVideo.meta ? `<div>${escapeHtml(selectedVideo.meta)}</div>` : ""}
          </div>
        </div>
        <div class="assignment-review-video-list">
          ${videoItems.map((item) => `
            <button
              type="button"
              class="assignment-review-video-btn ${item.key === selectedVideo.key ? "is-active" : ""}"
              data-review-video-key="${escapeHtml(item.key)}"
            >${escapeHtml(item.label)}</button>
          `).join("")}
        </div>
      </div>
    `
    : `
      <div class="assignment-brief-label">วิดีโอที่ส่งกลับล่าสุด</div>
      <div class="assignment-brief-empty">ยังไม่มีวิดีโอที่ส่งกลับล่าสุด</div>
    `;

  photosNode.querySelectorAll("[data-review-photo-url]").forEach((node) => {
    const url = String(node.getAttribute("data-review-photo-url") || "").trim();
    node.addEventListener("mouseenter", (event) => showAssignmentReviewHoverPreview(url, event));
    node.addEventListener("mousemove", (event) => positionAssignmentReviewHoverPreview(event));
    node.addEventListener("mouseleave", () => hideAssignmentReviewHoverPreview());
    node.addEventListener("focus", () => hideAssignmentReviewHoverPreview());
  });
  videosNode.querySelectorAll("[data-review-video-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.assignments.reviewSelectedVideoKey = String(button.getAttribute("data-review-video-key") || "").trim();
      renderAssignmentReviewSubmissionContent(assignment);
    });
  });
}

function renderAssignmentReviewSummary(assignment) {
  const card = qs("assignment-review-summary-card");
  const contentNode = qs("assignment-review-summary-content");
  const briefLinkWrap = qs("assignment-review-summary-brief-link-wrap");
  const briefLink = qs("assignment-review-summary-brief-link");
  const pageMode = getAssignmentPageMode();
  if (!card || !contentNode || !briefLinkWrap || !briefLink) return;

  briefLinkWrap.classList.add("hidden");

  const shouldShow = pageMode === "review" && Boolean(assignment);
  card.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    contentNode.className = "assignment-brief-empty";
    contentNode.innerHTML = "เลือกงานมอบหมายเพื่อดูสรุปสำหรับการตรวจงาน";
    return;
  }

  const bundle = state.assignments.deliverablesBundle && typeof state.assignments.deliverablesBundle === "object"
    ? state.assignments.deliverablesBundle
    : null;
  const latestSubmission = getLatestAssignmentSubmissionRow(assignment);
  const latestSubmissionId = Number(bundle?.latest_submission_id || assignment?.latest_submission_id || 0) || 0;
  const latestSubmittedAt = formatAssignmentWorkspaceUpdatedAt(
    latestSubmission?.created_at
    || assignment?.latest_submission_at
    || assignment?.updated_at
    || assignment?.created_at
    || ""
  ) || "-";

  contentNode.className = "assignment-brief-grid";
  contentNode.innerHTML = `
    <div class="assignment-brief-section">
      <div class="assignment-brief-label">งาน</div>
      <div class="assignment-brief-text">#${escapeHtml(String(Number(assignment.id || 0) || "-"))} | item #${escapeHtml(String(Number(assignment.content_item_id || 0) || "-"))}</div>
    </div>
    <div class="assignment-brief-section">
      <div class="assignment-brief-label">ผู้ส่งงาน</div>
      <div class="assignment-brief-text">${escapeHtml(getAssignmentAssigneeLabel(assignment))}</div>
    </div>
    <div class="assignment-brief-section">
      <div class="assignment-brief-label">สถานะ / รอบส่งล่าสุด</div>
      <div class="assignment-brief-text">${escapeHtml(String(assignment.state || "-").trim() || "-")}${latestSubmissionId ? ` | รอบส่ง #${latestSubmissionId}` : ""}</div>
    </div>
    <div class="assignment-brief-section">
      <div class="assignment-brief-label">ส่งล่าสุดเมื่อ</div>
      <div class="assignment-brief-text">${escapeHtml(latestSubmittedAt)}</div>
    </div>
  `;
}

function buildAssignmentWorkspaceSummaries(assignment) {
  if (!assignment) {
    return {
      state: "เลือกงานในกระบวนการนี้เพื่อดูสรุปของขั้นนี้",
      submission: "เลือกงานในกระบวนการนี้เพื่อดูสรุปของขั้นนี้",
      review: "เลือกงานในกระบวนการนี้เพื่อดูสรุปของขั้นนี้",
    };
  }

  const stateValue = String(assignment.state || "").trim().toLowerCase();
  const deliverablesBundle = state.assignments.deliverablesBundle || null;
  const deliverableCount = Array.isArray(deliverablesBundle?.deliverables) ? deliverablesBundle.deliverables.length : 0;
  const missingCount = Array.isArray(deliverablesBundle?.missing_deliverable_types) ? deliverablesBundle.missing_deliverable_types.length : 0;

  return {
    state:
      stateValue === "accepted" || stateValue === "closed"
        ? "งานนี้เสร็จแล้ว"
        : `สถานะปัจจุบัน: ${stateValue || "-"}${assignment?.updated_at ? ` | อัปเดตล่าสุด ${formatAssignmentWorkspaceUpdatedAt(assignment.updated_at)}` : ""}`,
    submission:
      deliverableCount > 0
        ? `มีงานส่งของรอบล่าสุด ${deliverableCount} รายการ${missingCount > 0 ? ` | ยังขาด ${missingCount}` : ""}`
        : "ยังไม่มีงานส่งของรอบล่าสุด",
    review:
      stateValue === "submitted" || stateValue === "resubmitted"
        ? "มีงานรอตรวจรับในขั้นนี้"
        : stateValue === "accepted" || stateValue === "closed"
          ? "ตรวจรับผลงานผ่านแล้ว"
          : stateValue === "revision_requested"
            ? "รอให้ผู้ทำงานส่งงานกลับอีกครั้งก่อนตรวจรับ"
            : "ส่วนนี้จะใช้งานเมื่อมีการส่งผลกลับระบบแล้ว",
  };
}

const ASSIGNMENT_PROCESS_2_SUMMARY_HTML = `
  <h4>กระบวนการ 2: ส่งงานไปทำ</h4>
  <ul>
    <li>ขั้น 1: ส่งงานไปทำ แสดงชุดลงหน้างาน เลือกผู้รับงาน และส่งออกไปทำ</li>
    <li>ขั้น 2: ลงงาน ดูคำสั่งงาน ส่งข้อมูลกลับ และติดตามคอมเมนต์ล่าสุด</li>
    <li>ขั้น 3: ตรวจงาน ดูงานที่ส่งกลับมา ขอแก้ หรือรับงานผ่าน</li>
  </ul>
`;

function buildAssignmentWorkSummaryHtml(assignment) {
  const latestComment = String(state.assignments.workLatestComment || "").trim();
  const isLoaded = Boolean(state.assignments.workLatestCommentLoaded);
  const isLoading = Boolean(state.assignments.workLatestCommentLoading);
  const body = latestComment
    ? escapeHtml(latestComment)
    : isLoading && !isLoaded
      ? "กำลังโหลดคอมเมนต์ล่าสุด..."
      : "ยังไม่มีคอมเมนต์ล่าสุด";
  return `
    <h4>คอมเมนต์ล่าสุด</h4>
    <p class="muted">${body}</p>
  `;
}

function getAssignmentLatestWorkComment(assignment, historyResult = null) {
  const candidates = [];
  const pushCandidate = (textValue, timeValue) => {
    const text = String(textValue || "").trim();
    if (!text) return;
    const timestamp = Date.parse(String(timeValue || "").trim() || "");
    candidates.push({
      text,
      time: Number.isFinite(timestamp) ? timestamp : 0,
    });
  };

  pushCandidate(assignment?.contributor_note, assignment?.updated_at);

  const submissions = Array.isArray(historyResult?.submissions) ? historyResult.submissions : [];
  submissions.forEach((submission) => {
    pushCandidate(submission?.reviewer_note, submission?.reviewed_at || submission?.created_at);
  });

  const transitions = Array.isArray(historyResult?.transitions) ? historyResult.transitions : [];
  transitions.forEach((transition) => {
    pushCandidate(transition?.note, transition?.created_at);
  });

  candidates.sort((a, b) => b.time - a.time);
  return candidates[0]?.text || "";
}

async function loadAssignmentLatestWorkComment() {
  const assignmentId = ensureSelectedAssignmentId();
  state.assignments.workLatestCommentLoading = true;
  try {
    const result = await api(`/api/assignments/${assignmentId}/history?limit=20`);
    if (Number(state.assignments.selectedId || 0) !== assignmentId) {
      return "";
    }
    state.assignments.workLatestComment = getAssignmentLatestWorkComment(getAssignmentById(assignmentId), result);
    state.assignments.workLatestCommentLoaded = true;
    return state.assignments.workLatestComment;
  } finally {
    if (Number(state.assignments.selectedId || 0) === assignmentId) {
      state.assignments.workLatestCommentLoading = false;
      if (getAssignmentPageMode() === "work") {
        const selectedAssignment = getAssignmentById(assignmentId);
        if (selectedAssignment) {
          syncAssignmentPageMode(selectedAssignment);
        }
      }
    }
  }
}

function syncAssignmentPageMode(assignment) {
  const pageMode = getAssignmentPageMode();
  const isEditor = currentRole() === "editor";
  const canSeeBaseTasks = canSeeAssignmentBaseTasksSurface();
  const canSeeCurrentWork = canSeeAssignmentCurrentWorkSurface();
  const canSeeExtendedManage = canSeeAssignmentExtendedManageSurface();
  const canSeeExtendedReview = canSeeAssignmentExtendedReviewSurface();
  if (pageMode === "handoff") {
    ensureAssignmentHandoffLayoutOrder();
  }
  const titleNode = qs("assignment-panel-title");
  const noteNode = qs("assignment-panel-note");
  const pageSummary = qs("assignment-page-summary");
  const createPanel = qs("assignment-manual-create-panel");
  const listPanel = qs("assignment-list-panel");
  const detailPanel = qs("assignment-detail-panel");
  const stateWorkspace = qs("assignment-state-workspace");
  const submissionWorkspace = qs("assignment-submission-workspace");
  const reviewWorkspace = qs("assignment-review-workspace");
  const reviewSummaryCard = qs("assignment-review-summary-card");
  const reviewSubmissionCard = qs("assignment-review-submission-card");
  const submissionForm = qs("assignment-submission-form");
  const workMonitor = qs("assignment-work-monitor");
  const deliverableEditor = qs("assignment-deliverable-editor");
  const deliverableActions = qs("assignment-deliverables-actions");
  const deliverablesCard = qs("assignment-deliverables-summary")?.closest(".assignment-deliverables-card") || null;
  const selectedSummary = qs("assignment-selected-summary");
  const guideBox = qs("assignment-next-action")?.closest(".assignment-guide") || null;
  const contextBriefCard = qs("assignment-context-brief")?.closest(".assignment-brief-card") || null;
  const contextBriefTitle = contextBriefCard?.querySelector(".assignment-subtitle") || null;
  const nextStepCard = qs("assignment-next-step-content")?.closest(".assignment-brief-card") || null;
  const debugBox = qs("assignment-debug-box");
  const loadSubmissionsBtn = qs("btn-assignment-load-submissions");
  const loadHistoryBtn = qs("btn-assignment-load-history");
  const hasAssignment = Number(assignment?.id || state.assignments.selectedId || 0) > 0;
  const hasContextItem = pageMode === "handoff" && Boolean(getAssignmentContextItem());
  const canActInWork = canActOnAssignmentWork(assignment);
  const isTrackOnlyInWork = isAssignmentTrackOnlySelection(assignment);
  const isSubmittedInWork = isAssignmentSubmittedSelection(assignment);
  const isReadOnlyInWork = isTrackOnlyInWork || isSubmittedInWork;

  renderAssignmentContextBrief(assignment);
  renderAssignmentWorkMonitor(assignment);
  renderAssignmentReviewSummary(assignment);
  renderAssignmentReviewSubmissionContent(assignment);

  if (titleNode) {
    titleNode.textContent = pageMode === "handoff"
      ? "กระบวนการ 2 · ขั้น 1: ส่งงานไปทำ"
      : pageMode === "work"
        ? "กระบวนการ 2 · ขั้น 2: ลงงาน"
        : "กระบวนการ 2 · ขั้น 3: ตรวจงาน";
  }
  if (noteNode) {
    noteNode.textContent = pageMode === "handoff"
      ? "เริ่มหลังจบการตรวจแก้และจัดชุดสั่งงาน ใช้สำหรับแสดงชุดลงหน้างาน เลือกผู้รับงาน กำหนดส่ง และส่งงานออกไป"
      : pageMode === "work"
        ? hasAssignment && (!canActInWork || isReadOnlyInWork)
          ? isSubmittedInWork
            ? "ใช้สำหรับดูสิ่งที่ส่งกลับล่าสุดของงานนี้และสถานะการรอตรวจ"
            : "ใช้สำหรับติดตามว่าใครเป็นผู้รับงาน สถานะงานปัจจุบัน และกำหนดส่งของงานนี้"
          : "ใช้สำหรับผู้ลงงานเปิดใบสั่งงาน กรอกข้อมูลส่งกลับ แนบรูป/วิดีโอ และส่งงานกลับ"
        : "ใช้สำหรับดูงานที่ส่งกลับมา ขอแก้ และรับงานผ่าน";
  }
  if (pageSummary) {
    if (pageMode === "handoff") {
      pageSummary.classList.remove("hidden");
      pageSummary.innerHTML = ASSIGNMENT_PROCESS_2_SUMMARY_HTML;
    } else if (pageMode === "work") {
      pageSummary.classList.add("hidden");
      pageSummary.innerHTML = "";
    } else {
      pageSummary.classList.add("hidden");
      pageSummary.innerHTML = "";
    }
  }
  if (createPanel && pageMode !== "handoff") {
    createPanel.classList.add("hidden");
  }
  if (createPanel && pageMode === "handoff" && !canSeeExtendedManage) {
    createPanel.classList.add("hidden");
  }
  if (listPanel) {
    listPanel.classList.toggle("hidden", !canSeeBaseTasks);
  }
  if (detailPanel) {
    detailPanel.classList.toggle("hidden", !canSeeCurrentWork || (pageMode === "handoff" ? true : !hasAssignment));
  }
  if (stateWorkspace) {
    stateWorkspace.classList.toggle("hidden", pageMode !== "handoff" || !canSeeExtendedManage);
  }
  if (submissionWorkspace) {
    submissionWorkspace.classList.toggle("hidden", !canSeeCurrentWork || pageMode === "handoff" || pageMode === "review");
  }
  if (reviewWorkspace) {
    reviewWorkspace.classList.toggle("hidden", !canSeeExtendedReview || pageMode !== "review");
  }
  if (reviewSummaryCard) {
    reviewSummaryCard.classList.toggle("hidden", !canSeeExtendedReview || pageMode !== "review" || !hasAssignment);
  }
  if (reviewSubmissionCard) {
    reviewSubmissionCard.classList.toggle("hidden", !canSeeExtendedReview || pageMode !== "review" || !hasAssignment);
  }
  if (submissionForm) {
    submissionForm.classList.toggle("hidden", pageMode === "review" || (pageMode === "work" && hasAssignment && (!canActInWork || isReadOnlyInWork)));
  }
  if (workMonitor) {
    workMonitor.classList.toggle("hidden", pageMode !== "work" || !hasAssignment || (!isReadOnlyInWork && canActInWork));
  }
  if (deliverableEditor) {
    deliverableEditor.classList.toggle("hidden", pageMode === "review" || (pageMode === "work" && hasAssignment && (!canActInWork || isReadOnlyInWork)));
  }
  if (deliverableActions) {
    deliverableActions.classList.toggle("hidden", pageMode === "review" || (pageMode === "work" && hasAssignment && (!canActInWork || isReadOnlyInWork)));
  }
  if (deliverablesCard) {
    deliverablesCard.classList.toggle("hidden", isEditor || (pageMode === "work" && hasAssignment && (!canActInWork || isReadOnlyInWork)));
  }
  if (selectedSummary) {
    selectedSummary.classList.toggle("hidden", pageMode === "work" || pageMode === "review");
  }
  if (guideBox) {
    guideBox.classList.toggle("hidden", pageMode === "work" || pageMode === "review");
  }
  if (contextBriefCard) {
    contextBriefCard.classList.toggle("hidden", pageMode === "work" || pageMode === "review");
  }
  if (contextBriefTitle) {
    contextBriefTitle.textContent = pageMode === "handoff" ? "คำสั่งงาน" : "ข้อมูลประกอบงาน";
  }
  if (nextStepCard) {
    nextStepCard.classList.toggle("hidden", pageMode === "work" || pageMode === "review");
  }
  if (debugBox) {
    debugBox.classList.toggle("hidden", !canSeeExtendedManage || pageMode === "work" || pageMode === "review");
  }
  if (loadSubmissionsBtn) {
    loadSubmissionsBtn.classList.toggle("hidden", isEditor || pageMode === "work");
  }
  if (loadHistoryBtn) {
    loadHistoryBtn.classList.toggle("hidden", isEditor || pageMode === "work");
  }
  applyFreelanceWorkerView(pageMode);
  syncAssignmentSubnav();
  renderManagedAssignmentsTable(state.assignments.managedRows);
  renderAssignmentsTable(state.assignments.rows);
  renderSubmittedAssignmentsTable(state.assignments.submittedRows);
  applyAssignmentModernClasses();
}

function applyAssignmentModernClasses() {
  const panel = qs("panel-assignments");
  if (!panel) return;
  panel.classList.add("as-scope");

  const addClassById = (id, className) => qs(id)?.classList.add(className);
  addClassById("assignment-page-summary", "as-alert-box");
  addClassById("assignment-subnav", "as-subnav");
  addClassById("assignment-list-panel", "as-list-panel");
  addClassById("assignment-detail-panel", "as-card-raised");
  addClassById("assignment-process-steps", "as-progress-steps");
  addClassById("assignment-state-workspace", "as-section");
  addClassById("assignment-submission-workspace", "as-section");
  addClassById("assignment-review-workspace", "as-section");
  addClassById("assignment-review-summary-card", "as-card-flat");
  addClassById("assignment-review-submission-card", "as-card-flat");
  addClassById("assignment-submission-verified-fields", "as-fieldset");
  addClassById("assignment-submission-question-fields", "as-fieldset");
  addClassById("assignment-submission-capture-guide", "as-fieldset");

  qs("assignment-next-action")?.closest(".assignment-guide")?.classList.add("as-guide");
  qs("assignment-context-brief")?.closest(".assignment-brief-card")?.classList.add("as-card");
  qs("assignment-next-step-content")?.closest(".assignment-brief-card")?.classList.add("as-card");
  qs("assignment-work-monitor")?.classList.add("as-card");
  qs("assignment-managed-list-wrap")?.classList.add("as-card");
  panel.querySelector(".assignment-submit-toolbar")?.classList.add("as-toolbar-actions");

  panel.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), select, textarea').forEach((node) => node.classList.add("as-input"));
  panel.querySelectorAll("label").forEach((node) => node.classList.add("as-label"));
  panel.querySelectorAll("button").forEach((node) => node.classList.add("as-btn-md"));
  panel.querySelectorAll("#assignment-subnav button").forEach((node) => node.classList.add("as-btn-sm"));
  panel.querySelectorAll(".assignment-step-toolbar .step-main, #btn-assignment-submit, #btn-assignment-request-revision, #btn-assignment-accept-submission")
    .forEach((node) => node.classList.add("as-btn-lg"));
  panel.querySelectorAll(".assignment-brief-empty, .assignment-deliverables-empty").forEach((node) => node.classList.add("as-empty-state"));
  panel.querySelectorAll(".workflow-badge").forEach((node) => node.classList.add("as-badge"));
}

function syncAssignmentWorkflowLayout(assignment) {
  const pageMode = getAssignmentPageMode();
  const isTrackOnlyInWork = isAssignmentTrackOnlySelection(assignment);
  const isSubmittedInWork = isAssignmentSubmittedSelection(assignment);
  const isReadOnlyInWork = isTrackOnlyInWork || isSubmittedInWork;
  const layout = getAssignmentWorkspaceLayout(assignment);
  const effectiveLayout = pageMode === "work" && assignment
    ? {
        ...layout,
        ...(canActOnAssignmentWork(assignment) && !isReadOnlyInWork
          ? null
          : {
              submissionTitle: isSubmittedInWork ? "ขั้นที่ 2: งานที่ส่งแล้ว / รอตรวจ" : "ขั้นที่ 2: ติดตามงาน",
              submissionHelp: isSubmittedInWork
                ? "งานนี้ส่งกลับแล้ว จึงเปิดได้แบบอ่านอย่างเดียวจนกว่าจะมีผลตรวจหรือถูกขอแก้"
                : "ส่วนนี้ใช้สำหรับติดตามผู้รับงาน สถานะปัจจุบัน กำหนดส่ง และเปิดใบสั่งงาน",
            }),
        stateMode: "hidden",
        submissionMode: "active",
        reviewMode: "hidden",
      }
    : layout;
  const summaries = buildAssignmentWorkspaceSummaries(assignment);
  const stateSection = qs("assignment-state-workspace");
  const submissionSection = qs("assignment-submission-workspace");
  const reviewSection = qs("assignment-review-workspace");
  const nextStepNode = qs("assignment-next-step-content");
  const stateSummary = qs("assignment-state-workspace-summary");
  const submissionSummary = qs("assignment-submission-workspace-summary");
  const reviewSummary = qs("assignment-review-workspace-summary");

  const applySectionState = (node, mode, summaryNode, summaryText) => {
    if (!node) return;
    const normalizedMode = assignment ? mode || "hidden" : "hidden";
    node.classList.toggle("is-active", normalizedMode === "active");
    node.classList.toggle("is-secondary", normalizedMode === "collapsed");
    node.classList.toggle("is-collapsed", normalizedMode === "collapsed");
    if (summaryNode) {
      summaryNode.textContent = summaryText || "เลือกงานในกระบวนการนี้เพื่อดูสรุปของขั้นนี้";
      summaryNode.classList.toggle("hidden", normalizedMode !== "collapsed");
    }
    if (normalizedMode === "hidden") {
      node.classList.add("hidden");
      node.classList.remove("is-active", "is-secondary", "is-collapsed");
      if (summaryNode) summaryNode.classList.add("hidden");
      return;
    }
    node.classList.remove("hidden");
  };

  applySectionState(stateSection, assignment ? effectiveLayout.stateMode : "hidden", stateSummary, summaries.state);
  applySectionState(submissionSection, assignment ? effectiveLayout.submissionMode : "hidden", submissionSummary, summaries.submission);
  applySectionState(reviewSection, assignment ? effectiveLayout.reviewMode : "hidden", reviewSummary, summaries.review);

  const stateTitle = qs("assignment-state-workspace-title");
  const stateHelp = qs("assignment-state-workspace-help");
  const submissionTitle = qs("assignment-submission-workspace-title");
  const submissionHelp = qs("assignment-submission-workspace-help");
  const reviewTitle = qs("assignment-review-workspace-title");
  const reviewHelp = qs("assignment-review-workspace-help");

  if (stateTitle) stateTitle.textContent = effectiveLayout.stateTitle;
  if (stateHelp) stateHelp.textContent = effectiveLayout.stateHelp;
  if (submissionTitle) submissionTitle.textContent = effectiveLayout.submissionTitle;
  if (submissionHelp) submissionHelp.textContent = effectiveLayout.submissionHelp;
  if (reviewTitle) reviewTitle.textContent = effectiveLayout.reviewTitle;
  if (reviewHelp) reviewHelp.textContent = effectiveLayout.reviewHelp;

  if (nextStepNode) {
    if (!assignment) {
      if (pageMode === "handoff" && getAssignmentContextItem()) {
        nextStepNode.className = "assignment-brief-grid";
        nextStepNode.innerHTML = `
          <div class="assignment-brief-section full-span">
            <div class="assignment-brief-label">ขั้นถัดไป</div>
            <div class="assignment-brief-text">ตรวจคำสั่งงาน เลือกผู้รับงาน กำหนดส่ง และกด "ส่งงานไปทำ" เพื่อสร้าง assignment ของรายการนี้</div>
          </div>
        `;
      } else {
        nextStepNode.className = "assignment-brief-empty";
        nextStepNode.textContent = "เลือกงานในกระบวนการนี้เพื่อดูขั้นถัดไปของงานนี้";
      }
    } else {
      nextStepNode.className = "assignment-brief-grid";
      nextStepNode.innerHTML = `
          <div class="assignment-brief-section full-span">
          <div class="assignment-brief-label">${escapeHtml(effectiveLayout.nextTitle)}</div>
          <div class="assignment-brief-text">${escapeHtml(effectiveLayout.nextBody)}</div>
        </div>
      `;
    }
  }
  syncAssignmentPageMode(assignment);
}

function buildAssignmentActionOptionsHtml(options = [], placeholderText) {
  const rows = Array.isArray(options) ? options : [];
  return [`<option value="">${escapeHtml(placeholderText)}</option>`]
    .concat(
      rows.map((row) => `<option value="${escapeHtml(row.value || "")}">${escapeHtml(row.label || row.value || "")}</option>`)
    )
    .join("");
}

function updateAssignmentActionControls(assignment) {
  const stateSelect = qs("assignment-state-action");
  const stateHelp = qs("assignment-state-action-help");
  const stateButton = qs("btn-assignment-update-state");
  const submissionSelect = qs("assignment-submission-action");
  const submissionHelp = qs("assignment-submission-action-help");
  const submissionButton = qs("btn-assignment-submit");
  const syncUploadButton = qs("btn-assignment-sync-upload");
  const canPatchState = canPatchAssignmentState();

  if (!assignment) {
    if (stateSelect) {
      stateSelect.innerHTML = buildAssignmentActionOptionsHtml([], "-- เลือกงานก่อน --");
      stateSelect.value = "";
      stateSelect.disabled = true;
    }
    if (stateHelp) {
      stateHelp.textContent = canPatchState
        ? "เลือกงานก่อน ระบบจะจัด action ที่เหมาะกับช่วงนี้ให้อัตโนมัติ"
        : "role นี้ไม่มีสิทธิ์เปลี่ยนสถานะงาน";
    }
    if (stateButton) {
      stateButton.disabled = true;
      stateButton.textContent = "อัปเดตสถานะงาน";
    }
    if (submissionSelect) {
      submissionSelect.innerHTML = buildAssignmentActionOptionsHtml([], "-- เลือกงานก่อน --");
      submissionSelect.value = "";
      submissionSelect.disabled = true;
    }
    if (submissionHelp) {
      submissionHelp.textContent = "ระบบจะเลือก action ส่งงานให้ตรงกับสถานะของงานนี้";
    }
    if (submissionButton) {
      submissionButton.disabled = true;
      submissionButton.textContent = "ส่งผลกลับระบบ";
    }
    if (syncUploadButton) {
      syncUploadButton.disabled = true;
    }
    const imageResetCheckbox = qs("assignment-review-image-reset");
    const videoResetCheckbox = qs("assignment-review-video-reset");
    if (imageResetCheckbox) imageResetCheckbox.checked = false;
    if (videoResetCheckbox) videoResetCheckbox.checked = false;
    syncAssignmentReviewResetReasonUI();
    return;
  }

  const stateValue = String(assignment.state || "").trim().toLowerCase();
  const isTrackOnlyInWork = isAssignmentTrackOnlySelection(assignment);
  const isSubmittedInWork = isAssignmentSubmittedSelection(assignment);
  const isReadOnlyInWork = isTrackOnlyInWork || isSubmittedInWork;
  const config = ASSIGNMENT_UI_STATE_CONFIG[stateValue] || ASSIGNMENT_PROCESS_DEFAULT;
  const stateActions = filterAssignmentStateActionsForRole(
    Array.isArray(config.stateActions) ? config.stateActions : []
  );
  const submissionActions = Array.isArray(config.submissionActions) ? config.submissionActions : [];
  const canEditorSubmitFromAssignmentSurface = !isEditorUser();

  if (stateSelect) {
    const currentValue = String(stateSelect.value || "").trim().toLowerCase();
    stateSelect.innerHTML = buildAssignmentActionOptionsHtml(stateActions, "-- เลือก action ที่ทำได้ --");
    stateSelect.value = stateActions.some((row) => row.value === currentValue)
      ? currentValue
      : String(stateActions[0]?.value || "");
    stateSelect.disabled = !canPatchState || stateActions.length === 0;
  }
  if (stateHelp) {
    stateHelp.textContent = !canPatchState
      ? "role นี้ไม่มีสิทธิ์เปลี่ยนสถานะงาน"
      : stateActions.length === 0
        ? "role นี้ไม่มี action ที่ทำได้ในสถานะนี้"
        : String(config.stateHelp || "").trim() || "เลือก action ที่เหมาะกับช่วงนี้";
  }
  if (stateButton) {
    stateButton.disabled = !canPatchState || stateActions.length === 0;
    stateButton.textContent = String(config.stateButtonLabel || "อัปเดตสถานะงาน");
  }

  if (submissionSelect) {
    const currentValue = String(submissionSelect.value || "").trim().toLowerCase();
    submissionSelect.innerHTML = buildAssignmentActionOptionsHtml(submissionActions, "-- ยังไม่มี action ส่งงานในสถานะนี้ --");
    submissionSelect.value = submissionActions.some((row) => row.value === currentValue)
      ? currentValue
      : String(submissionActions[0]?.value || "");
    submissionSelect.disabled = !canEditorSubmitFromAssignmentSurface || isReadOnlyInWork || submissionActions.length === 0;
  }
  if (submissionHelp) {
    submissionHelp.textContent = !canEditorSubmitFromAssignmentSurface
      ? "editor ส่งงานผ่าน article/event workspace เท่านั้น"
      : isSubmittedInWork
      ? "งานนี้ส่งกลับแล้ว รอผลตรวจจากฝั่งภายใน หากถูกขอแก้จะกลับมาอยู่ในรายการงานที่ต้องทำ"
      : isTrackOnlyInWork
        ? "มุมมองนี้ใช้ติดตามงานเท่านั้น เลือกงานจากรายการลงงานเพื่อส่งกลับระบบ"
      : String(config.submissionHelp || "").trim() || "ระบบจะเลือก action ส่งงานให้ตรงกับสถานะของงานนี้";
  }
  if (submissionButton) {
    submissionButton.disabled = !canEditorSubmitFromAssignmentSurface || isReadOnlyInWork || submissionActions.length === 0;
    submissionButton.textContent = String(config.submissionButtonLabel || "ส่งผลกลับระบบ");
  }
  if (syncUploadButton) {
    syncUploadButton.disabled = !canEditorSubmitFromAssignmentSurface || isReadOnlyInWork || submissionActions.length === 0;
  }
  syncAssignmentReviewResetReasonUI();
}

function applyLogoutUI() {
  document.body.classList.remove("is-authenticated");
  state.token = "";
  state.user = null;
  state.visibleUsers = [];
  state.freelanceUsers = [];
  state.cleanup = { rows: [] };
  state.assignments.rows = [];
  state.assignments.managedRows = [];
  state.assignments.submittedRows = [];
  state.assignments.selectedId = null;
  state.assignments.trackOnlySelectionId = null;
  state.assignments.submittedSelectionId = null;
  state.assignments.itemLandingApplied = false;
  state.assignments.assignmentLandingApplied = false;
  getRawSelectedIds().clear();
  state.dashboard.rawMergeOpen = false;
  state.dashboard.rawMergeMasterId = 0;
  setRawBulkMergeOpen(false);
  sessionStorage.removeItem("collector_token");
  sessionStorage.removeItem("collector_login_at");
  localStorage.removeItem("collector_token");
  localStorage.removeItem("collector_login_at");
  state.loginAt = "";
  setStatus("auth-status", "ยังไม่ได้เข้าสู่ระบบ", true);
  setStatus("assignment-status", "");
  setStatus("assignment-create-status", "");
  setUserManagementVisibility(false);
  updateUserManagementUI();
  setRawVisibility(false);
  setAssignmentRoleVisibility();
  state.preferredTab = "home";
  syncPreferredTabUrl();
  activateIndexPanelForPreferredTab();
  renderLandingDebugState("logout-reset");
  renderAssignmentAssigneeOptions();
  setAssignmentDetailVisible(false);
  setAssignmentProcessGuide(null);
  renderManagedAssignmentsTable([]);
  renderAssignmentsTable([]);
  renderRawTable([]);
  resetAssignmentPreviews();
  updateSourceInputUI();
}

function updateAuthUI() {
  if (!state.user) {
    document.body.classList.remove("is-authenticated");
    setStatus("auth-status", "ยังไม่ได้เข้าสู่ระบบ", true);
    qs("btn-home-users")?.classList.add("hidden");
    setUserManagementVisibility(false);
    state.cleanup = { rows: [] };
    updateUserManagementUI();
    setPlaceVisibility(false);
    setRawVisibility(false);
    setEventsVisibility(false);
    setTransportVisibility(false);
    setAssignmentRoleVisibility();
    syncUsersContextTopTabs();
    updateSourceInputUI();
    return;
  }
  document.body.classList.add("is-authenticated");
  let loginTimeText = "";
  if (state.loginAt) {
    const loginDate = new Date(state.loginAt);
    if (!Number.isNaN(loginDate.getTime())) {
      loginTimeText = loginDate.toLocaleString("th-TH", {
        dateStyle: "short",
        timeStyle: "medium",
      });
    }
  }
  setStatus(
    "auth-status",
    `เข้าสู่ระบบแล้ว: ${state.user.email} (${state.user.role})${loginTimeText ? ` | เวลา login: ${loginTimeText}` : ""} - กด "ออกจากระบบ" เพื่อจบเซสชันนี้`
  );
  qs("btn-home-users")?.classList.toggle("hidden", !canAccessContributorManagementSurface());
  setUserManagementVisibility(canAccessContributorManagementSurface());
  updateUserManagementUI();
  setPlaceVisibility(canAccessInternalStaffWorkspaces());
  setRawVisibility(!isExternalContributorUser());
  setEventsVisibility(canAccessInternalStaffWorkspaces());
  setTransportVisibility(false);
  setAssignmentRoleVisibility();
  syncUsersContextTopTabs();
  if (String(window.location.pathname || "/") === "/") {
    const landing = resolveRequestedLandingState({
      requestedTab: getRequestedTabFromUrl(),
      fallbackTab: state.preferredTab || getDefaultLandingTabForRole(currentRole()),
    });
    state.preferredTab = landing.resolvedPreferredTab;
    syncPreferredTabUrl();
    activateIndexPanelForPreferredTab();
  }
  renderAssignmentAssigneeOptions();
  renderLandingDebugState("updateAuthUI");
  updateSourceInputUI();
}

function renderSourceIngestions(rows) {
  const table = qs("table-source-ingestions");
  if (!table) return;

  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.items) ? rows.items : [];
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  list.forEach((row) => {
    const tr = document.createElement("tr");
    const canReview = String(row?.status || "").trim().toLowerCase() === "collected";
    const itemCount = Number(row?.item_count || 0) || 0;
    tr.innerHTML = `
      <td>${escapeHtml(row.batch_uid || "-")}</td>
      <td>${escapeHtml(row.adapter || "-")}</td>
      <td>${escapeHtml(row.status || "-")}</td>
      <td>${row.item_count ?? 0}</td>
      <td>${escapeHtml(row.created_at || "")}</td>
      <td>${canReview ? `<button type="button" data-action="review-intake" data-batch-uid="${escapeHtml(row.batch_uid || "")}" data-adapter="${escapeHtml(row.adapter || "")}" data-source-label="${escapeHtml(row.source_label || "")}" data-item-count="${itemCount}">เปิด review</button>` : "-"}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.onclick = async (event) => {
    const btn = event.target.closest("button[data-action='review-intake']");
    if (!btn) return;
    const batchUid = String(btn.dataset.batchUid || "").trim();
    const adapter = String(btn.dataset.adapter || "").trim();
    const sourceLabel = String(btn.dataset.sourceLabel || "").trim();
    const itemCount = Number(btn.dataset.itemCount || 0) || 0;
    if (!batchUid) return;
    try {
      setStatus("source-status", `กำลังโหลด review ของ batch ${batchUid}...`);
      const rawItemsResponse = await api(`/api/source-raw-items?batch_uid=${encodeURIComponent(batchUid)}&limit=${Math.max(itemCount, 1000)}`);
      openSourceIntakeModal({
        batchUid,
        adapter,
        sourceLabel,
        query: "",
        rawItems: rawItemsResponse?.items || [],
      });
    } catch (err) {
      setStatus("source-status", err.message, true);
    }
  };
}

function workflowBadge(item) {
  const snapshot = getItemWorkflowSnapshot(item);
  const status = snapshot.compatibilityStatus;
  if (status === "content_in_progress" || status === "needs_revision") {
    return `<span class="workflow-badge workflow-badge-cleaned" title="status: ${escapeHtml(status)}">กำลังเขียนบทความ</span>`;
  }
  if (status === "in_review") {
    return `<span class="workflow-badge workflow-badge-generated" title="status: ${escapeHtml(status)}">รอตรวจและอนุมัติ</span>`;
  }
  if (status === "approved" || status === "unpublished") {
    return `<span class="workflow-badge workflow-badge-sent" title="status: ${escapeHtml(status)}">อนุมัติแล้ว พร้อม sync</span>`;
  }
  const stage = normalizeDashboardWorkflowStage(status);
  const rawLabel = escapeHtml(status || "raw");
  if (stage === "published") {
    return `<span class="workflow-badge workflow-badge-sent" title="status: ${rawLabel}">เผยแพร่แล้ว</span>`;
  }
  if (stage === "generated") {
    return `<span class="workflow-badge workflow-badge-generated" title="status: ${rawLabel}">ส่งงานไปทำ/กำลังดำเนินการ</span>`;
  }
  if (stage === "cleaned") {
    return `<span class="workflow-badge workflow-badge-cleaned" title="status: ${rawLabel}">ผ่านการ clean data แล้ว</span>`;
  }
  return `<span class="workflow-badge workflow-badge-raw" title="status: ${rawLabel}">รอคัดเข้า AI</span>`;
}

function getArticleSurfaceEntry(item) {
  const id = Number(item?.id || 0) || 0;
  if (!id) return null;
  const targetUrl = getEditorialSurfaceUrlForItem(item, getItemWorkflowSnapshot(item).compatibilityStatus);
  return {
    label: "รับงาน",
    url: targetUrl || editorWorkspaceUrl(id),
  };
}

function getItemClaimHolderLabel(item) {
  const claimedBy = item?.claimed_by_user || null;
  if (claimedBy) {
    return String(claimedBy.display_name || claimedBy.email || `user #${Number(claimedBy.id || 0)}`).trim();
  }
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  return claimedByUserId ? `user #${claimedByUserId}` : "";
}

function canClaimPreparationItem(item) {
  const role = currentRole();
  if (role !== "owner" && role !== "admin" && role !== "user") return false;
  return Number(item?.claimed_by_user_id || 0) === 0;
}

function canReleasePreparationItem(item) {
  const role = currentRole();
  if (role !== "owner" && role !== "admin" && role !== "user") return false;
  return Number(item?.claimed_by_user_id || 0) > 0 && Number(item?.claimed_by_user_id || 0) === Number(state.user?.id || 0);
}

function canTakeOverPreparationItem(item) {
  if (!isAdminUser()) return false;
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  if (!claimedByUserId || claimedByUserId === Number(state.user?.id || 0)) return false;
  const actorRole = String(state.user?.role || "").trim().toLowerCase();
  const claimantRole = String(item?.claimed_by_user?.role || "").trim().toLowerCase();
  const getRoleRank = (role) => role === "owner" ? 3 : role === "admin" ? 2 : role === "user" ? 1 : 0;
  return getRoleRank(actorRole) > getRoleRank(claimantRole);
}

function getItemAssignmentOwnerLabel(item) {
  const assignee = item?.assignment_owner?.assignee || null;
  if (assignee) {
    return String(assignee.display_name || assignee.email || `user #${Number(assignee.id || 0)}`).trim();
  }
  return "";
}

function getItemAssignedByLabel(item) {
  const assignedBy = item?.assignment_owner?.assigned_by || null;
  if (assignedBy) {
    return String(assignedBy.display_name || assignedBy.email || `user #${Number(assignedBy.id || 0)}`).trim();
  }
  return "";
}

function getViewerScopeReasonLabel(item) {
  const reason = String(item?.viewer_scope_reason || "").trim().toLowerCase();
  if (reason === "owner_global") return "owner global";
  if (reason === "raw_pool_visible") return "raw pool";
  if (reason === "claimed_by_me") return "claimed by me";
  if (reason === "claimed_by_descendant") return "claimed by descendant";
  if (reason === "assigned_to_me") return "assigned to me";
  if (reason === "assigned_to_descendant") return "assigned to descendant";
  if (reason === "assigned_by_me_external") return "assigned by me";
  return "out of scope";
}

function shortDisplay(label) {
  const value = String(label || "").trim();
  if (!value) return "";
  if (value.includes("@")) return value.split("@")[0].trim();
  return value;
}

function formatPreparationClaimBadge(item) {
  const holderLabel = getItemClaimHolderLabel(item);
  const assigneeLabel = getItemAssignmentOwnerLabel(item);
  const assignedByLabel = getItemAssignedByLabel(item);
  const scopeState = String(item?.item_work_scope_state || "").trim().toLowerCase();
  const chips = [];

  if (scopeState === "raw_pool" || !Number(item?.claimed_by_user_id || 0)) {
    chips.push('<span class="intake-chip">ยังไม่มีผู้รับงาน</span>');
  }
  if (scopeState === "claimed" || scopeState === "claimed_and_assigned" || Number(item?.claimed_by_user_id || 0) > 0) {
    chips.push(`<span class="intake-chip">รับงานโดย ${escapeHtml(shortDisplay(holderLabel) || "unknown")}</span>`);
  }
  if ((scopeState === "assigned" || scopeState === "claimed_and_assigned") && assigneeLabel) {
    chips.push(`<span class="intake-chip">มอบหมายให้ ${escapeHtml(shortDisplay(assigneeLabel))}</span>`);
  }
  if ((scopeState === "assigned" || scopeState === "claimed_and_assigned") && assignedByLabel) {
    chips.push(`<span class="intake-chip">ผู้มอบหมาย ${escapeHtml(shortDisplay(assignedByLabel))}</span>`);
  }
  return `<div class="intake-chip-row">${chips.join("")}</div>`;
}

function normalizeDashboardWorkflowStage(workflowInput) {
  if (workflowInput && typeof workflowInput === "object") {
    const snapshot = getItemWorkflowSnapshot(workflowInput);
    const productionState = snapshot.productionState;
    const publicationState = snapshot.publicationState;
    if (publicationState === "published") return "published";
    if (publicationState === "approved" || publicationState === "unpublished" || productionState === "ready_for_publish" || productionState === "generated" || productionState === "in_review") {
      return "generated";
    }
    if (
      productionState === "analyzed"
      || productionState === "brief_generated"
      || productionState === "ready_for_content"
      || productionState === "content_in_progress"
      || productionState === "needs_revision"
      || productionState === "rejected"
    ) {
      return "cleaned";
    }
    if (productionState === "collected") return "raw";
    return normalizeDashboardWorkflowStage(snapshot.compatibilityStatus);
  }
  const status = String(workflowInput || "").trim().toLowerCase();
  if (status === "published") return "published";
  if (status === "generated" || status === "approved" || status === "unpublished") return "generated";
  if (
    status === "cleaned"
    || status === "ready_for_content"
    || status === "brief_generated"
    || status === "analyzed"
    || status === "content_in_progress"
    || status === "in_review"
    || status === "needs_revision"
    || status === "rejected"
  ) {
    return "cleaned";
  }
  if (status === "source_intake" || status === "source" || status === "collected") return "raw";
  return "raw";
}

const RAW_INTAKE_FILTERS = Object.freeze([
  Object.freeze({ value: "all", label: "ทั้งหมด" }),
  Object.freeze({ value: "raw", label: "รอคัดเข้า AI" }),
  Object.freeze({ value: "cleaned", label: "กำลังคัดข้อมูล" }),
]);

const RAW_REVIEW_FILTERS = Object.freeze([
  Object.freeze({ value: "all", label: "ทั้งหมด" }),
  Object.freeze({ value: "review", label: "รอตรวจชุดสั่งงาน" }),
  Object.freeze({ value: "handoff", label: "พร้อมส่งต่อ" }),
]);

function getPreparationQueueItems(items = state.items) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((item) => {
    const bucket = resolveQueueBucket(item);
    return bucket === "raw_prep" || bucket === "field_pack_review";
  });
}

function buildRawIntakeFilterHtml(items = []) {
  const counts = {
    all: items.length,
    raw: items.filter((item) => isRawPreparationItem(item)).length,
    cleaned: items.filter((item) => !isRawPreparationItem(item)).length,
  };
  return RAW_INTAKE_FILTERS.map((filter) => {
    const active = String(state.dashboard.rawIntakeFilter || "all").trim().toLowerCase() === filter.value;
    const count = Number(counts[filter.value] || 0);
    return `<button type="button" class="raw-stage-filter${active ? " is-active" : ""}" data-intake-filter="${escapeHtml(filter.value)}">${escapeHtml(filter.label)} <span>${count}</span></button>`;
  }).join("");
}

function buildRawReviewFilterHtml(items = []) {
  const counts = {
    all: items.length,
    review: items.filter((item) => !isHandoffEligibleItem(item)).length,
    handoff: items.filter((item) => isHandoffEligibleItem(item)).length,
  };
  return RAW_REVIEW_FILTERS.map((filter) => {
    const active = String(state.dashboard.rawReviewFilter || "all").trim().toLowerCase() === filter.value;
    const count = Number(counts[filter.value] || 0);
    return `<button type="button" class="raw-stage-filter${active ? " is-active" : ""}" data-review-filter="${escapeHtml(filter.value)}">${escapeHtml(filter.label)} <span>${count}</span></button>`;
  }).join("");
}

function getDashboardPrimaryEntryAction(item) {
  const id = Number(item?.id || 0) || 0;
  if (!id) return null;

  const bucket = resolveQueueBucket(item);
  if (bucket === "published") {
    return getArticleSurfaceEntry(item);
  }
  if (bucket === "assignment" || bucket === "handoff") {
    return {
      label: "ไปส่งงานไปทำ",
      url: `/?tab=handoff&item_id=${id}`,
    };
  }
  if (bucket === "field_pack_review") {
    return {
      label: "ตรวจชุดสั่งงาน",
      url: `/item-editor.html?id=${id}`,
    };
  }
  return {
    label: "Clean",
    url: `/clean-item.html?id=${id}`,
  };
}

function splitRawQueueByFieldPack(items = []) {
  const intake = [];
  const review = [];
  for (const item of Array.isArray(items) ? items : []) {
    const bucket = resolveQueueBucket(item);
    if (bucket === "field_pack_review") {
      review.push(item);
    } else if (bucket === "raw_prep") {
      intake.push(item);
    }
  }
  return { intake, review };
}

function buildRawQueueStatusLabel(item, queueType) {
  const bucket = resolveQueueBucket(item);
  if (queueType === "review") {
    return bucket === "handoff" ? "พร้อมส่งต่อ" : "รอตรวจชุดสั่งงาน";
  }
  return isRawPreparationItem(item) ? "รอคัดเข้า AI" : "กำลังคัดข้อมูล";
}

function buildRawQueueStatusBadgeClass(item, queueType) {
  const bucket = resolveQueueBucket(item);
  if (queueType === "review") {
    return bucket === "handoff" ? "workflow-badge-sent" : "workflow-badge-generated";
  }
  return isRawPreparationItem(item) ? "workflow-badge-raw" : "workflow-badge-cleaned";
}

function renderRawQueueTable({
  tableId,
  items = [],
  canManage = false,
  showInterestingness = true,
  queueType = "intake",
  emptyText = "ยังไม่มีรายการ",
}) {
  const table = qs(tableId);
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const headRow = table.querySelector("thead tr");
  if (!tbody || !headRow) return;

  headRow.innerHTML = `
    ${canManage && queueType === "intake" ? '<th class="raw-select-cell"><input type="checkbox" id="raw-select-all" aria-label="เลือกทั้งหมดในตาราง" /></th>' : ""}
    <th>ID</th>
    <th>ประเภท</th>
    <th>หมวดหมู่</th>
    <th class="raw-title-column">ชื่อเรื่อง</th>
    ${showInterestingness ? "<th>น่าสนใจ</th>" : ""}
    <th>สถานะ</th>
    <th>ผู้รับงาน</th>
    <th>การทำงาน</th>
  `;
  tbody.innerHTML = "";

  if (!items.length) {
    const tr = document.createElement("tr");
    const colspan = (canManage && queueType === "intake")
      ? (showInterestingness ? 9 : 8)
      : (showInterestingness ? 8 : 7);
    tr.innerHTML = `<td colspan="${colspan}" class="muted">${emptyText}</td>`;
    tbody.appendChild(tr);
    return;
  }

  items.forEach((item) => {
    const tr = document.createElement("tr");
    const id = Number(item.id) || 0;
    const isJustExported = state.justExportedItemId === id;
    const isSelected = getRawSelectedIds().has(id);
    const interestingness = item?.interestingness || {};
    const interestingnessReasons = Array.isArray(interestingness?.reasons) ? interestingness.reasons.filter(Boolean) : [];
    const isRawRow = isRawPreparationItem(item);
    const statusLabel = buildRawQueueStatusLabel(item, queueType);
    const statusBadgeClass = buildRawQueueStatusBadgeClass(item, queueType);
    const readyForHandoff = isHandoffEligibleItem(item);
    const primaryUrl = queueType === "review"
      ? `/item-editor.html?id=${id}`
      : `/clean-item.html?id=${id}`;
    const primaryLabel = queueType === "review"
      ? (readyForHandoff ? "พร้อมส่งต่อ" : "ตรวจชุดสั่งงาน")
      : "คัดข้อมูล";

    tr.dataset.itemId = String(id);
    tr.className = isJustExported ? "row-highlight" : "";
    tr.innerHTML = `
      ${canManage && queueType === "intake" ? `<td class="raw-select-cell"><input type="checkbox" data-action="select" data-id="${id}" ${isSelected ? "checked" : ""} aria-label="เลือกรายการ ${id}" /></td>` : ""}
      <td>${id}</td>
      <td>${escapeHtml(item.type || "-")}</td>
      <td>${escapeHtml(item.category || "-")}</td>
      <td class="raw-title-cell">
        <div class="raw-main-text">${escapeHtml(item.title || "")}</div>
      </td>
      ${showInterestingness ? `
      <td>
        ${isRawRow ? `
        <div class="raw-interest-wrap" title="${escapeHtml(interestingnessReasons.join(" | "))}">
          <span class="intake-badge ${interestingnessBadgeClass(interestingness.label)}">${escapeHtml((interestingness.label || "ข้อมูลยังบาง") + " #" + Number(interestingness.score || 0))}</span>
        </div>` : ""}
      </td>` : ""}
      <td><span class="workflow-badge ${escapeHtml(statusBadgeClass)}">${escapeHtml(statusLabel)}</span></td>
      <td>${formatPreparationClaimBadge(item)}</td>
      <td class="raw-actions-cell">
        <button type="button" data-action="open-state-entry" data-id="${id}" data-url="${escapeHtml(primaryUrl)}">${escapeHtml(primaryLabel)}</button>
        ${canClaimPreparationItem(item) ? `<button type="button" data-action="claim-item" data-id="${id}">รับงานนี้</button>` : ""}
        ${canReleasePreparationItem(item) ? `<button type="button" data-action="release-item" data-id="${id}" class="utility-action">ปล่อยงาน</button>` : ""}
        ${canTakeOverPreparationItem(item) ? `<button type="button" data-action="takeover-item" data-id="${id}" class="fail">Take over</button>` : ""}
        ${canManage ? `<button data-action="delete" data-id="${id}" class="fail">ลบ</button>` : ""}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function focusAssignmentsTab() {
  applyLandingState({
    requestedTab: "assignments",
    fallbackTab: state.preferredTab,
    syncUrl: true,
    refreshAssignments: true,
    reason: "focusAssignmentsTab",
  });
}

function getSelectedRawItems(items = state.items) {
  const selectedIds = getRawSelectedIds();
  return (Array.isArray(items) ? items : []).filter((item) => selectedIds.has(Number(item?.id || 0)));
}

function pruneRawSelection(items = state.items) {
  const selectedIds = getRawSelectedIds();
  const validIds = new Set((Array.isArray(items) ? items : []).map((item) => Number(item?.id || 0)).filter(Boolean));
  for (const id of Array.from(selectedIds)) {
    if (!validIds.has(id)) {
      selectedIds.delete(id);
    }
  }
  if (state.dashboard.rawMergeMasterId && !validIds.has(Number(state.dashboard.rawMergeMasterId || 0))) {
    state.dashboard.rawMergeMasterId = 0;
  }
}

function setRawBulkMergeOpen(open) {
  state.dashboard.rawMergeOpen = Boolean(open);
  const modal = qs("raw-bulk-merge-modal");
  if (!modal) return;
  modal.classList.toggle("hidden", !open);
  modal.setAttribute("aria-hidden", open ? "false" : "true");
}

function renderRawBulkToolbar(items = state.items) {
  const toolbar = qs("raw-bulk-toolbar");
  const summary = qs("raw-bulk-summary");
  const categorySelect = qs("raw-bulk-category");
  const categoryBtn = qs("btn-raw-bulk-category");
  const mergeBtn = qs("btn-raw-bulk-merge");
  const deleteBtn = qs("btn-raw-bulk-delete");
  if (!toolbar || !summary || !categorySelect || !categoryBtn || !mergeBtn || !deleteBtn) return;

  const canManage = canManageBulkContentItems();
  const selected = getSelectedRawItems(items);
  const selectedCount = selected.length;
  toolbar.classList.toggle("hidden", !canManage || selectedCount === 0);
  if (!canManage) return;

  summary.textContent = selectedCount
    ? `เลือกแล้ว ${selectedCount} รายการ | ใช้ได้เฉพาะ admin/owner`
    : "ยังไม่ได้เลือกรายการ";
  categoryBtn.disabled = selectedCount < 1 || !String(categorySelect.value || "").trim();
  mergeBtn.disabled = selectedCount < 2;
  deleteBtn.disabled = selectedCount < 1;
}

function renderRawBulkMergeModal() {
  const listNode = qs("raw-bulk-merge-list");
  const summaryNode = qs("raw-bulk-merge-summary");
  const statusNode = qs("raw-bulk-merge-status");
  const confirmBtn = qs("btn-raw-bulk-merge-confirm");
  if (!listNode || !summaryNode || !statusNode || !confirmBtn) return;

  const selected = getSelectedRawItems();
  const selectedCount = selected.length;
  if (!selectedCount) {
    listNode.innerHTML = "";
    summaryNode.textContent = "ยังไม่มีรายการที่เลือก";
    statusNode.textContent = "";
    confirmBtn.disabled = true;
    return;
  }

  if (!selected.some((item) => Number(item?.id || 0) === Number(state.dashboard.rawMergeMasterId || 0))) {
    state.dashboard.rawMergeMasterId = Number(selected[0]?.id || 0) || 0;
  }

  const secondaryItems = selected.filter((item) => Number(item?.id || 0) !== Number(state.dashboard.rawMergeMasterId || 0));
  const secondaryTotals = secondaryItems.reduce((acc, item) => {
    const preview = item?.bulk_preview || {};
    acc.source += Number(preview.source_count || 0);
    acc.media += Number(preview.media_count || 0);
    acc.evidence += Number(preview.evidence_count || 0);
    acc.approved += Number(preview.approved_context_count || 0);
    return acc;
  }, { source: 0, media: 0, evidence: 0, approved: 0 });

  summaryNode.textContent = `เลือกรายการหลัก 1 รายการ จากที่เลือก ${selectedCount} รายการ | รายการรอง ${secondaryItems.length} รายการ จะย้าย source ${secondaryTotals.source} | media ${secondaryTotals.media} | evidence ${secondaryTotals.evidence} | approved context ${secondaryTotals.approved}`;
  statusNode.textContent = "";
  confirmBtn.disabled = selectedCount < 2 || !Number(state.dashboard.rawMergeMasterId || 0);
  listNode.innerHTML = selected.map((item) => {
    const id = Number(item?.id || 0) || 0;
    const checked = id === Number(state.dashboard.rawMergeMasterId || 0);
    const preview = item?.bulk_preview || {};
    const blockers = Array.isArray(preview.blockers) ? preview.blockers : [];
    const note = checked
      ? "รายการนี้จะเป็น master และคงข้อมูลหลักไว้"
      : "รายการนี้จะถูกรวมเข้ารายการหลักและถูก mark เป็น deleted";
    const snapshot = getItemWorkflowSnapshot(item);
    return `
      <label class="bulk-merge-card bulk-merge-choice">
        <input type="radio" name="raw-bulk-merge-master" value="${id}" ${checked ? "checked" : ""} />
        <div>
          <div class="bulk-merge-title">#${id} ${escapeHtml(item?.title || "(ไม่มีชื่อ)")}</div>
          <div class="bulk-merge-meta">
            ประเภท ${escapeHtml(item?.type || "-")} | หมวด ${escapeHtml(item?.category || "-")} | สถานะ ${escapeHtml(snapshot.compatibilityStatus || "raw")}
          </div>
          <div class="bulk-merge-meta">แหล่งข้อมูล: ${escapeHtml(item?.source_name || "-")}</div>
          <div class="bulk-merge-preview">
            <span>source ${Number(preview.source_count || 0)}</span>
            <span>media ${Number(preview.media_count || 0)}</span>
            <span>evidence ${Number(preview.evidence_count || 0)}</span>
            <span>approved ${Number(preview.approved_context_count || 0)}</span>
          </div>
          ${blockers.length ? `<div class="bulk-merge-blockers">blockers: ${escapeHtml(blockers.map((entry) => entry.label).join(", "))}</div>` : ""}
          <div class="bulk-merge-note muted">${escapeHtml(note)}</div>
        </div>
      </label>
    `;
  }).join("");

  listNode.onchange = (event) => {
    const input = event.target.closest('input[name="raw-bulk-merge-master"]');
    if (!input) return;
    state.dashboard.rawMergeMasterId = Number(input.value || 0) || 0;
    renderRawBulkMergeModal();
  };
}

function openRawBulkMergeModal() {
  const selected = getSelectedRawItems();
  if (selected.length < 2) {
    setStatus("source-status", "ต้องเลือกอย่างน้อย 2 รายการก่อน merge", true);
    return;
  }
  if (!Number(state.dashboard.rawMergeMasterId || 0)) {
    state.dashboard.rawMergeMasterId = Number(selected[0]?.id || 0) || 0;
  }
  renderRawBulkMergeModal();
  setRawBulkMergeOpen(true);
}

function closeRawBulkMergeModal() {
  state.dashboard.rawMergeOpen = false;
  state.dashboard.rawMergeMasterId = 0;
  setRawBulkMergeOpen(false);
}

function syncPreferredTabUrl() {
  const params = new URLSearchParams(window.location.search);
  params.set("tab", state.preferredTab);
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

function resetIndexPanelState() {
  const panels = Array.from(document.querySelectorAll(".panel"));
  panels.forEach((panel) => {
    panel.classList.remove("active");
    panel.classList.remove("hidden");
  });
  panels.forEach((panel) => panel.classList.add("hidden"));
}

function enforceExclusivePrimaryPanel(targetPanelId = "home") {
  const primaryPanelIds = ["home", "place", "raw", "assignments", "events", "users"];
  primaryPanelIds.forEach((id) => {
    const node = qs(`panel-${id}`);
    if (!node) return;
    const isTarget = id === targetPanelId;
    node.classList.toggle("hidden", !isTarget);
    node.classList.toggle("active", isTarget);
  });
}

function activateIndexPanelForPreferredTab() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  tabs.forEach((tab) => tab.classList.remove("active"));
  resetIndexPanelState();
  const normalizedPreferredTab = String(state.preferredTab || "").trim().toLowerCase();
  syncIndexShellChrome(normalizedPreferredTab);
  syncUsersContextTopTabs(normalizedPreferredTab);
  const targetTopTabId = getPreferredTopTabId();
  if (targetTopTabId) {
    qs(targetTopTabId)?.classList.add("active");
  }
  const targetPanelId = ["handoff", "work", "review", "assignments"].includes(normalizedPreferredTab)
    ? "assignments"
    : normalizedPreferredTab;
  const targetPanel = qs(`panel-${targetPanelId}`);
  if (targetPanel) {
    targetPanel.classList.remove("hidden");
    targetPanel.classList.add("active");
  }
  enforceExclusivePrimaryPanel(targetPanelId);
  syncAssignmentPageMode(getAssignmentById(state.assignments.selectedId));
  renderLandingDebugState("activate-panel");
  return { normalizedPreferredTab, targetPanelId };
}

function resolveRequestedLandingState({ requestedTab = "", fallbackTab = state.preferredTab } = {}) {
  const normalizedRequestedTab = String(requestedTab || "").trim().toLowerCase();
  const normalizedFallbackTab = String(fallbackTab || "").trim().toLowerCase();
  const seed = normalizedRequestedTab || normalizedFallbackTab || getDefaultLandingTabForRole(currentRole());
  const resolvedPreferredTab = resolvePreferredTab(seed, normalizedFallbackTab || seed);
  return {
    requestedTab: normalizedRequestedTab,
    resolvedPreferredTab,
  };
}

function applyLandingState({
  requestedTab = "",
  fallbackTab = state.preferredTab,
  syncUrl = true,
  refreshAssignments = true,
  reason = "apply-landing-state",
} = {}) {
  const next = resolveRequestedLandingState({ requestedTab, fallbackTab });
  state.preferredTab = next.resolvedPreferredTab;
  const preferredTopTab = resolvePreferredTopTabNode(state.preferredTab);
  const navMode = String(preferredTopTab?.dataset?.nav || "").trim().toLowerCase();
  const navHref = String(preferredTopTab?.dataset?.href || "").trim();
  if (navMode === "page" && navHref) {
    renderLandingDebugState(reason, {
      requested_tab_input: String(requestedTab || "").trim().toLowerCase(),
      resolved_target_panel: "(page-nav)",
      page_nav_href: navHref,
    });
    if (window.location.pathname !== navHref) {
      window.location.href = navHref;
    }
    return;
  }
  if (syncUrl) syncPreferredTabUrl();
  const normalizedPreferredTab = String(state.preferredTab || "").trim().toLowerCase();
  const { targetPanelId } = activateIndexPanelForPreferredTab();
  if (refreshAssignments) {
    if (targetPanelId === "assignments" || ["handoff", "work", "review"].includes(normalizedPreferredTab)) {
      refreshAssignmentWorkspaceForCurrentMode({ showStatus: false }).catch((err) => {
        setStatus("assignment-status", err.message, true);
      });
    }
  }
  renderLandingDebugState(reason, {
    requested_tab_input: String(requestedTab || "").trim().toLowerCase(),
    resolved_target_panel: targetPanelId,
  });
}

function applyPreferredLandingTab() {
  applyLandingState({
    requestedTab: getRequestedTabFromUrl(),
    fallbackTab: state.preferredTab,
    syncUrl: true,
    refreshAssignments: true,
    reason: "applyPreferredLandingTab",
  });
}

function renderRawTable(items) {
  const tableWrap = qs("raw-table-wrap");
  if (!tableWrap) return;
  const legacyFilterRoot = qs("raw-stage-filters");
  if (legacyFilterRoot) {
    legacyFilterRoot.innerHTML = "";
    legacyFilterRoot.classList.add("hidden");
  }
  const list = sortRawItems(getPreparationQueueItems(items));
  const split = splitRawQueueByFieldPack(list);
  const canManage = canManageBulkContentItems();
  const requestedIntakeFilter = String(state.dashboard.rawIntakeFilter || "all").trim().toLowerCase() || "all";
  const activeIntakeFilter = RAW_INTAKE_FILTERS.some((filter) => filter.value === requestedIntakeFilter)
    ? requestedIntakeFilter
    : "all";
  if (activeIntakeFilter !== requestedIntakeFilter) {
    state.dashboard.rawIntakeFilter = activeIntakeFilter;
  }
  const requestedReviewFilter = String(state.dashboard.rawReviewFilter || "all").trim().toLowerCase() || "all";
  const activeReviewFilter = RAW_REVIEW_FILTERS.some((filter) => filter.value === requestedReviewFilter)
    ? requestedReviewFilter
    : "all";
  if (activeReviewFilter !== requestedReviewFilter) {
    state.dashboard.rawReviewFilter = activeReviewFilter;
  }

  const filteredIntake = activeIntakeFilter === "all"
    ? split.intake
    : split.intake.filter((item) => {
      const isRaw = isRawPreparationItem(item);
      if (activeIntakeFilter === "raw") return isRaw;
      if (activeIntakeFilter === "cleaned") return !isRaw;
      return true;
    });
  const filteredReview = activeReviewFilter === "all"
    ? split.review
    : split.review.filter((item) => {
      const readyForHandoff = isHandoffEligibleItem(item);
      if (activeReviewFilter === "review") return !readyForHandoff;
      if (activeReviewFilter === "handoff") return readyForHandoff;
      return true;
    });
  const visibleIntake = state.dashboard.rawShowAll ? filteredIntake : filteredIntake.slice(0, state.dashboard.rawLimit);
  const visibleReview = filteredReview;
  pruneRawSelection(filteredIntake);

  tableWrap.innerHTML = `
    <div class="card">
      <div class="toolbar compact-toolbar">
        <h3 class="section-title" style="margin:0;">Raw Intake / Clean Prep</h3>
        <button id="btn-toggle-raw-intake" type="button">${state.dashboard.rawIntakeCollapsed ? "แสดงตาราง" : "ซ่อนตาราง"}</button>
      </div>
      <div class="toolbar compact-toolbar">${buildRawIntakeFilterHtml(split.intake)}</div>
      <div class="table-wrap${state.dashboard.rawIntakeCollapsed ? " hidden" : ""}" id="raw-intake-table-wrap">
        <table id="table-raw-intake">
          <thead><tr></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="toolbar compact-toolbar">
        <h3 class="section-title" style="margin:0;">Field Pack Review</h3>
        <button id="btn-toggle-raw-review" type="button">${state.dashboard.rawReviewCollapsed ? "แสดงตาราง" : "ซ่อนตาราง"}</button>
      </div>
      <div class="toolbar compact-toolbar">${buildRawReviewFilterHtml(split.review)}</div>
      <div class="table-wrap${state.dashboard.rawReviewCollapsed ? " hidden" : ""}" id="raw-review-table-wrap">
        <table id="table-raw-review">
          <thead><tr></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  `;

  renderRawQueueTable({
    tableId: "table-raw-intake",
    items: visibleIntake,
    canManage,
    showInterestingness: true,
    queueType: "intake",
    emptyText: "ยังไม่มีรายการในช่วงคัดข้อมูล",
  });
  renderRawQueueTable({
    tableId: "table-raw-review",
    items: visibleReview,
    canManage,
    showInterestingness: false,
    queueType: "review",
    emptyText: "ยังไม่มีรายการรอตรวจชุดสั่งงาน",
  });

  const summaryNode = qs("raw-summary");
  if (summaryNode) {
    const suffix = state.dashboard.rawShowAll || filteredIntake.length <= state.dashboard.rawLimit
      ? ""
      : ` | กำลังแสดง intake ${visibleIntake.length}/${filteredIntake.length}`;
    const loadedCount = Array.isArray(state.items) ? state.items.length : 0;
    summaryNode.textContent = `loaded=${loadedCount} | intake=${filteredIntake.length} | review=${filteredReview.length}${suffix}`;
  }

  const showAllBtn = qs("btn-show-all-raw");
  if (showAllBtn) {
    const canExpand = filteredIntake.length > state.dashboard.rawLimit;
    showAllBtn.classList.toggle("hidden", !canExpand);
    showAllBtn.textContent = state.dashboard.rawShowAll ? "แสดงเฉพาะล่าสุด" : "แสดงทั้งหมด";
  }

  const toggleBtn = qs("btn-toggle-raw-table");
  if (tableWrap && toggleBtn) {
    tableWrap.classList.toggle("hidden", state.dashboard.rawTableCollapsed);
    toggleBtn.textContent = state.dashboard.rawTableCollapsed ? "แสดงตารางรายการ" : "ซ่อนตารางรายการ";
  }
  const intakeToggleBtn = qs("btn-toggle-raw-intake");
  if (intakeToggleBtn) {
    intakeToggleBtn.onclick = () => {
      state.dashboard.rawIntakeCollapsed = !state.dashboard.rawIntakeCollapsed;
      renderRawTable(items);
    };
  }
  const reviewToggleBtn = qs("btn-toggle-raw-review");
  if (reviewToggleBtn) {
    reviewToggleBtn.onclick = () => {
      state.dashboard.rawReviewCollapsed = !state.dashboard.rawReviewCollapsed;
      renderRawTable(items);
    };
  }

  renderRawBulkToolbar(filteredIntake);

  const selectAll = qs("raw-select-all");
  const syncIntakeSelectionUi = () => {
    const selectableIds = visibleIntake.map((item) => Number(item?.id || 0)).filter(Boolean);
    const selectedIds = getRawSelectedIds();
    if (selectAll) {
      selectAll.checked = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
      selectAll.indeterminate = selectableIds.some((id) => selectedIds.has(id)) && !selectAll.checked;
    }
    renderRawBulkToolbar(filteredIntake);
  };
  if (selectAll) {
    const selectableIds = visibleIntake.map((item) => Number(item?.id || 0)).filter(Boolean);
    const selectedIds = getRawSelectedIds();
    syncIntakeSelectionUi();
    selectAll.onchange = (event) => {
      const checked = Boolean(event.target?.checked);
      for (const id of selectableIds) {
        if (checked) {
          selectedIds.add(id);
        } else {
          selectedIds.delete(id);
        }
      }
      document.querySelectorAll('#table-raw-intake tbody input[data-action="select"]').forEach((node) => {
        node.checked = checked;
      });
      syncIntakeSelectionUi();
    };
  }

  const intakeTbody = document.querySelector("#table-raw-intake tbody");
  const reviewTbody = document.querySelector("#table-raw-review tbody");
  if (intakeTbody) intakeTbody.onchange = (event) => {
    const checkbox = event.target.closest('input[data-action="select"]');
    if (!checkbox) return;
    const id = Number(checkbox.dataset.id || 0);
    if (!id) return;
    const selectedIds = getRawSelectedIds();
    if (checkbox.checked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    syncIntakeSelectionUi();
  };

  const handleRowAction = async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id || 0);
    if (!id) return;

    if (action === "open-state-entry") {
      const url = String(btn.dataset.url || "").trim();
      if (!url) return;
      window.location.href = url;
      return;
    }

    if (action === "delete") {
      if (!window.confirm(`ลบรายการ ${id} ใช่หรือไม่?`)) return;
      await api(`/api/items/${id}`, { method: "DELETE" });
      await refreshAll();
      return;
    }

    if (action === "claim-item") {
      await api(`/api/items/${id}/claim`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setStatus("source-status", `รับงาน item #${id} แล้ว`);
      await refreshAll();
      return;
    }

    if (action === "release-item") {
      if (!window.confirm(`ปล่อยงาน item #${id} ใช่หรือไม่?`)) return;
      await api(`/api/items/${id}/release`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setStatus("source-status", `ปล่อยงาน item #${id} แล้ว`);
      await refreshAll();
      return;
    }

    if (action === "takeover-item") {
      if (!window.confirm(`Take over item #${id} ใช่หรือไม่?`)) return;
      await api(`/api/items/${id}/takeover`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      setStatus("source-status", `Take over item #${id} แล้ว`);
      await refreshAll();
    }
  };
  if (intakeTbody) intakeTbody.onclick = handleRowAction;
  if (reviewTbody) reviewTbody.onclick = handleRowAction;
}

function setSourceIntakeOpen(open) {
  state.sourceIntake.open = Boolean(open);
  const modal = qs("source-intake-modal");
  if (!modal) return;
  modal.classList.toggle("hidden", !open);
  modal.setAttribute("aria-hidden", open ? "false" : "true");
}

function buildSourceIntakeExistingItemOptions(selectedId, candidates = []) {
  const prioritized = [];
  const seen = new Set();

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    for (const match of Array.isArray(candidate?.merge?.matches) ? candidate.merge.matches : []) {
      const itemId = Number(match?.item?.id || 0);
      if (!itemId || seen.has(itemId)) continue;
      seen.add(itemId);
      prioritized.push(match.item);
    }
  }

  for (const item of Array.isArray(state.items) ? state.items : []) {
    const itemId = Number(item?.id || 0);
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    prioritized.push(item);
    if (prioritized.length >= 50) break;
  }

  return prioritized.map((item) => {
    const itemId = Number(item?.id || 0);
    const label = `#${itemId} ${String(item?.title || "(ไม่มีชื่อ)")}`;
    return `<option value="${itemId}" ${itemId === Number(selectedId || 0) ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function chooseDefaultSourceIntakeMode(candidates = []) {
  const mergeRecommended = candidates.filter((candidate) => candidate?.recommendedDecision === "merge").length;
  return mergeRecommended > 0 ? "merge" : "new";
}

function chooseDefaultSourceIntakeExistingItemId(candidates = []) {
  const suggestedIds = Array.isArray(candidates)
    ? candidates
        .map((candidate) => Number(candidate?.merge?.suggested?.item?.id || 0) || 0)
        .filter((id) => id > 0)
    : [];

  if (!suggestedIds.length) {
    return 0;
  }

  const uniqueIds = new Set(suggestedIds);
  return uniqueIds.size === 1 ? suggestedIds[0] : 0;
}

function renderSourceIntakeModal() {
  const summaryNode = qs("source-intake-summary");
  const statusNode = qs("source-intake-status");
  const destinationNode = qs("source-intake-destination");
  const listNode = qs("source-intake-list");
  if (!summaryNode || !statusNode || !listNode || !destinationNode) return;

  const candidates = Array.isArray(state.sourceIntake.candidates) ? state.sourceIntake.candidates : [];
  const queryText = state.sourceIntake.query ? ` จากคำค้น "${state.sourceIntake.query}"` : "";
  summaryNode.textContent = candidates.length
    ? `พบ ${candidates.length} รายการ${queryText} สำหรับ place เดียว เลือกปลายทางทั้งชุดครั้งเดียว แล้วเลือกรายการที่รับหรือข้าม`
    : "ยังไม่มีรายการให้คัดรับ";
  statusNode.textContent = "";

  const existingOptions = buildSourceIntakeExistingItemOptions(state.sourceIntake.selectedExistingItemId, candidates);
  const mergeMode = state.sourceIntake.selectedMode === "merge";
  destinationNode.innerHTML = `
    <div class="intake-decision-grid">
      <div>
        <label>ปลายทางข้อมูลทั้งชุด</label>
        <select id="source-intake-mode">
          <option value="new" ${!mergeMode ? "selected" : ""}>รับเป็นรายการใหม่ (place เดียว)</option>
          <option value="merge" ${mergeMode ? "selected" : ""}>รวมเข้ารายการเดิม (id เดียวทั้งชุด)</option>
        </select>
      </div>
      <div id="source-intake-existing-wrap" class="${mergeMode ? "" : "hidden"}">
        <label>เลือกรายการเดิม (ใช้ทั้งชุด)</label>
        <select id="source-intake-existing-item">
          <option value="">เลือกรายการเดิม</option>
          ${existingOptions}
        </select>
      </div>
    </div>
  `;

  listNode.innerHTML = candidates.map((candidate) => {
    const mergeSuggested = candidate.merge?.suggested?.item;
    const mergeReasons = candidate.merge?.suggested?.reasons || [];
    const factRows = [];
    if (candidate.address) {
      factRows.push(`<div><strong>ที่อยู่:</strong> ${escapeHtml(compactText(candidate.address, 160))}</div>`);
    }
    if (candidate.phone) {
      factRows.push(`<div><strong>เบอร์โทร:</strong> ${escapeHtml(candidate.phone)}</div>`);
    }
    if (candidate.openingHours?.length) {
      factRows.push(`<div><strong>เวลาเปิด:</strong> ${escapeHtml(formatFactList(candidate.openingHours, 160))}</div>`);
    }
    if (candidate.serviceFacts?.length) {
      factRows.push(`<div><strong>บริการ:</strong> ${escapeHtml(formatFactList(candidate.serviceFacts, 160))}</div>`);
    }
    if (candidate.priceSignals?.length) {
      factRows.push(`<div><strong>ราคา:</strong> ${escapeHtml(formatFactList(candidate.priceSignals, 120))}</div>`);
    }
    if (candidate.menuSections?.length) {
      factRows.push(`<div><strong>หมวดเมนู:</strong> ${escapeHtml(formatFactList(candidate.menuSections, 160))}</div>`);
    }
    if (candidate.menuHighlights?.length) {
      factRows.push(`<div><strong>เมนูเด่น:</strong> ${escapeHtml(formatFactList(candidate.menuHighlights, 160))}</div>`);
    } else if (candidate.menuUrl) {
      factRows.push(`<div><strong>เมนู:</strong> <span class="intake-inline-ellipsis" title="${escapeHtml(candidate.menuUrl)}">${escapeHtml(candidate.menuUrl)}</span></div>`);
    }
    const decisionRows = [];
    decisionRows.push(`<label>คัดรับรายการนี้</label>
      <select data-intake-decision="${candidate.rawItemId}">
        <option value="accept" ${candidate.selectedDecision === "accept" ? "selected" : ""}>รับรายการนี้</option>
        <option value="skip" ${candidate.selectedDecision === "skip" ? "selected" : ""}>ข้ามรายการนี้</option>
      </select>`);

    return `
      <article class="intake-card" data-raw-item-id="${candidate.rawItemId}">
        <div class="intake-card-header">
          <div>
            <h4>${escapeHtml(candidate.title)}</h4>
            <p class="muted">${escapeHtml(candidate.categoryLabel)} | ${escapeHtml(buildRawCandidateSummary(candidate))}</p>
          </div>
          <div class="intake-badges">
            <span class="intake-badge ${intakePriorityClass(candidate.priority.label)}">${escapeHtml(candidate.priority.label)}</span>
            <span class="intake-badge ${intakeMergeClass(candidate.merge.label)}">${escapeHtml(candidate.merge.label)}</span>
          </div>
        </div>
        <div class="intake-chip-row">
          ${candidate.priority.reasons.map((reason) => `<span class="intake-chip">${escapeHtml(reason)}</span>`).join("")}
          ${mergeReasons.map((reason) => `<span class="intake-chip intake-chip-merge">${escapeHtml(reason)}</span>`).join("")}
        </div>
        <div class="intake-summary-grid">
          <div><strong>แหล่งข้อมูล:</strong> <span class="intake-inline-ellipsis" title="${escapeHtml(candidate.sourceUrl || "-")}">${escapeHtml(candidate.sourceUrl || "-")}</span></div>
          <div><strong>คำอธิบาย:</strong> ${escapeHtml(candidate.snippet || "-")}</div>
          <div><strong>คำแนะนำระบบ:</strong> ${escapeHtml(candidate.recommendedDecision === "merge" ? "รวมกับรายการเดิม" : candidate.recommendedDecision === "new" ? "รับเป็นรายการใหม่" : "ตรวจเพิ่มหรือข้าม")}</div>
          <div><strong>รายการเดิมที่ใกล้สุด:</strong> ${escapeHtml(mergeSuggested ? `#${Number(mergeSuggested.id || 0)} ${mergeSuggested.title || ""}` : "-")}</div>
          <div><strong>เหตุผลที่ระบบเทียบ:</strong> ${escapeHtml(mergeReasons.length ? mergeReasons.join(" | ") : "-")}</div>
          <div><strong>คะแนนเทียบ:</strong> ${escapeHtml(candidate.merge?.suggested ? String(Number(candidate.merge.suggested.score || 0) || 0) : "-")}</div>
          ${factRows.join("")}
        </div>
        <div class="intake-decision-grid">
          ${decisionRows.join("")}
        </div>
      </article>
    `;
  }).join("");

  listNode.querySelectorAll("select[data-intake-decision]").forEach((select) => {
    select.addEventListener("change", (event) => {
      const rawItemId = Number(event.target.getAttribute("data-intake-decision") || 0);
      const candidate = state.sourceIntake.candidates.find((row) => row.rawItemId === rawItemId);
      if (!candidate) return;
      candidate.selectedDecision = String(event.target.value || "skip").trim() === "accept" ? "accept" : "skip";
    });
  });

  qs("source-intake-mode")?.addEventListener("change", (event) => {
    state.sourceIntake.selectedMode = String(event.target?.value || "new").trim().toLowerCase() === "merge" ? "merge" : "new";
    renderSourceIntakeModal();
  });

  qs("source-intake-existing-item")?.addEventListener("change", (event) => {
    state.sourceIntake.selectedExistingItemId = Number(event.target?.value || 0) || 0;
  });
}

function openSourceIntakeModal({ batchUid, adapter, sourceLabel, query, rawItems }) {
  const scoringQuery = adapter === "google_maps" ? query : "";
  const candidates = (Array.isArray(rawItems) ? rawItems : [])
    .map((row) => normalizeRawCandidate(row, scoringQuery))
    .sort((a, b) => {
      if (b.priority.rank !== a.priority.rank) return b.priority.rank - a.priority.rank;
      if (b.priority.score !== a.priority.score) return b.priority.score - a.priority.score;
      if (b.merge.rank !== a.merge.rank) return b.merge.rank - a.merge.rank;
      return ((b.userRatingCount ?? b.reviewCount) || 0) - ((a.userRatingCount ?? a.reviewCount) || 0);
    });

  state.sourceIntake = {
    open: true,
    batchUid,
    adapter,
    sourceLabel,
    query: scoringQuery,
    selectedMode: chooseDefaultSourceIntakeMode(candidates),
    selectedExistingItemId: chooseDefaultSourceIntakeExistingItemId(candidates),
    candidates,
  };
  renderSourceIntakeModal();
  setSourceIntakeOpen(true);
}

function closeSourceIntakeModal() {
  state.sourceIntake = {
    open: false,
    batchUid: "",
    adapter: "",
    sourceLabel: "",
    query: "",
    selectedMode: "new",
    selectedExistingItemId: 0,
    candidates: [],
  };
  setSourceIntakeOpen(false);
}

function renderUsersTable(rows) {
  const table = qs("table-users");
  if (!table) return;

  const list = Array.isArray(rows) ? rows : Array.isArray(rows?.items) ? rows.items : [];
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8" class="muted">ยังไม่มีรายการผู้ใช้ที่แสดงได้</td>`;
    tbody.appendChild(tr);
    return;
  }

  list.forEach((user) => {
    const roleValue = String(user.role || "").toLowerCase();
    const managerLabel = resolveManagerLabel(user);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${Number(user.id) || 0}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.display_name || "")}</td>
      <td class="user-profile-cell">${escapeHtml(summarizeUserProfile(user))}</td>
      <td><span class="user-role-pill user-role-${getSafeRoleClass(roleValue)}">${escapeHtml(user.role || "user")}</span></td>
      <td class="user-manager-cell">${escapeHtml(managerLabel)}</td>
      <td>${escapeHtml(user.created_at || "")}</td>
      <td><span class="muted">Backend Admin</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function normalizeCollectPayload(adapter) {
  if (adapter !== "google_maps" && adapter !== "manual") return [];

  const query = getSourceQueryValue();
  if (!query) {
    throw new Error(adapter === "manual" ? "กรุณาวาง URL อย่างน้อย 1 รายการ" : "กรุณากรอกคำค้นหา Google Maps");
  }

  if (adapter === "manual") {
    return toManualUrlRows(query);
  }

  const basePayload = {
    query,
    language: "th",
    region: "th",
    max_results_per_query: Number(readSourceLocationPanelState().maxResultsPerQuery) || 20,
    category: "attractions",
  };

  if (adapter !== "google_maps") {
    return basePayload;
  }

  const locationParse = parseSourceLocationPanelState();
  if (!locationParse.ok || !locationParse.values) {
    return basePayload;
  }

  return {
    ...basePayload,
    location: {
      lat: locationParse.values.latitude,
      lng: locationParse.values.longitude,
    },
    radius: locationParse.values.radiusM,
  };
}

function buildAssignmentsActionablePath() {
  const limit = parsePositiveInt(qs("assignment-limit")?.value, 50) || 50;
  return `/api/assignments/mine?scope=actionable&limit=${limit}`;
}

function buildAssignmentsManagedPath() {
  if (!canSeeManagedAssignmentsTable()) return "";
  const limit = parsePositiveInt(qs("assignment-limit")?.value, 50) || 50;
  return `/api/assignments/mine?scope=managed&limit=${limit}`;
}

function buildAssignmentsSubmittedPath() {
  const limit = parsePositiveInt(qs("assignment-limit")?.value, 50) || 50;
  return `/api/assignments/mine?scope=submitted&limit=${limit}`;
}

function buildAssignmentsMinePath() {
  const limit = parsePositiveInt(qs("assignment-limit")?.value, 50) || 50;
  if (currentRole() === "editor") {
    const selfId = parsePositiveInt(state.user?.id, 0);
    if (getAssignmentPageMode() === "work") {
      return buildAssignmentsActionablePath();
    }
    if (selfId) {
      return `/api/assignments/mine?assignee_user_id=${selfId}&limit=${limit}`;
    }
    return `/api/assignments/mine?limit=${limit}`;
  }
  if (getAssignmentPageMode() === "work") {
    return buildAssignmentsActionablePath();
  }
  if (getAssignmentPageMode() === "review") {
    const includeTracking = isOwnerReviewTrackingEnabled() ? "&include_tracking=1" : "";
    return `/api/assignments/mine?scope=review&limit=${limit}${includeTracking}`;
  }
  if (isFreelanceUser()) {
    return `/api/assignments/mine?limit=${limit}`;
  }
  const selfId = parsePositiveInt(state.user?.id, 0);
  if (isAdminUser()) {
    const assigneeId = parsePositiveInt(qs("assignment-assignee-id")?.value, 0);
    if (assigneeId) {
      return `/api/assignments/mine?assignee_user_id=${assigneeId}&limit=${limit}`;
    }
    return `/api/assignments/mine?limit=${limit}`;
  }
  const assigneeId = parsePositiveInt(qs("assignment-assignee-id")?.value, 0);
  if (selfId && (!assigneeId || assigneeId === selfId)) {
    return `/api/assignments/mine?assignee_user_id=${selfId}&limit=${limit}`;
  }
  if (!assigneeId) {
    return `/api/assignments/mine?assigned_by_me=1&limit=${limit}`;
  }
  return `/api/assignments/mine?assignee_user_id=${assigneeId}&limit=${limit}`;
}

function getAssignmentAssignerLabel(assignment) {
  const row = assignment && typeof assignment === "object" ? assignment : null;
  const assignerId = Number(row?.assigned_by_user_id || 0) || 0;
  if (!assignerId) return "-";
  const directLabel = String(row?.assigned_by_display_name || "").trim()
    || String(row?.assigned_by_email || "").trim();
  if (directLabel) return directLabel;
  const assigner = (Array.isArray(state.visibleUsers) ? state.visibleUsers : []).find((candidate) => Number(candidate?.id || 0) === assignerId);
  if (assigner) {
    return String(assigner.display_name || "").trim() || String(assigner.email || "").trim() || `user #${assignerId}`;
  }
  if (Number(state.user?.id || 0) === assignerId) {
    return String(state.user?.display_name || "").trim() || String(state.user?.email || "").trim() || "คุณ";
  }
  return `user #${assignerId}`;
}

function getAssignmentAssigneeLabel(assignment) {
  const row = assignment && typeof assignment === "object" ? assignment : null;
  if (!row) return "-";
  const external = row.external_assignee_profile_json && typeof row.external_assignee_profile_json === "object"
    ? row.external_assignee_profile_json
    : null;
  const externalName = String(external?.name || "").trim();
  const externalContacts = [
    String(external?.phone || "").trim(),
    String(external?.email || "").trim().toLowerCase(),
    String(external?.line_id || "").trim(),
  ].filter(Boolean);
  if (externalName && externalContacts.length > 0) {
    return `${externalName} | ${externalContacts.join(" / ")}`;
  }
  if (externalName) {
    return externalName;
  }
  if (externalContacts.length > 0) {
    return externalContacts.join(" / ");
  }
  return String(
    row.assignee_display_name
    || row.assignee_email
    || row.assignee_name
    || row.assignee_contact
    || row.assignee_user_id
    || "-"
  ).trim() || "-";
}

function summarizeAssignment(assignment) {
  if (!assignment) return "ยังไม่ได้เลือกงานในกระบวนการนี้";
  const id = Number(assignment.id || 0) || "-";
  const contentItemId = Number(assignment.content_item_id || 0) || "-";
  const assigneeLabel = getAssignmentAssigneeLabel(assignment);
  const stateValue = String(assignment.state || "-");
  return `งาน #${id} | item=${contentItemId} | assignee=${assigneeLabel} | state=${stateValue}`;
}

function buildAssignmentBriefUrl(itemId, assignmentId = 0) {
  const params = new URLSearchParams();
  const normalizedItemId = Number(itemId || 0) || 0;
  const normalizedAssignmentId = Number(assignmentId || 0) || 0;
  if (normalizedItemId > 0) params.set("id", String(normalizedItemId));
  if (normalizedAssignmentId > 0) params.set("assignment_id", String(normalizedAssignmentId));
  const query = params.toString();
  return `/field-brief.html${query ? `?${query}` : ""}`;
}

function formatAssignmentBriefExpectedDeliverables(values = []) {
  const rows = Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (!rows.length) return '<div class="muted">-</div>';
  return `<div class="assignment-brief-chip-list">${rows.map((row) => `<span class="assignment-brief-chip">${escapeHtml(row)}</span>`).join("")}</div>`;
}

function buildAssignmentMonthEndOfDay(baseDate, monthsToAdd) {
  const source = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  const targetMonthDate = new Date(source.getFullYear(), source.getMonth() + Number(monthsToAdd || 0), 1);
  const lastDayOfMonth = new Date(targetMonthDate.getFullYear(), targetMonthDate.getMonth() + 1, 0).getDate();
  const targetDay = Math.min(source.getDate(), lastDayOfMonth);
  return new Date(targetMonthDate.getFullYear(), targetMonthDate.getMonth(), targetDay, 23, 59, 59, 999);
}

function normalizeAssignmentCreateDueAt(value) {
  const preset = String(value || "").trim().toLowerCase();
  if (!preset) return "";
  const now = new Date();
  const baseDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let dueDate = null;
  if (preset === "day_1" || preset === "day_3" || preset === "day_7") {
    const days = preset === "day_1" ? 1 : preset === "day_3" ? 3 : 7;
    dueDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + days, 23, 59, 59, 999);
  } else if (preset === "week_1" || preset === "week_2" || preset === "week_3") {
    const weeks = preset === "week_1" ? 1 : preset === "week_2" ? 2 : 3;
    dueDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + (weeks * 7), 23, 59, 59, 999);
  } else if (preset === "month_1") {
    dueDate = buildAssignmentMonthEndOfDay(baseDate, 1);
  }
  if (!dueDate || Number.isNaN(dueDate.getTime())) {
    throw new Error("กำหนดส่งไม่ถูกต้อง");
  }
  return dueDate.toISOString();
}

function formatAssignmentDueAtLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const dateLabel = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(parsed);
  return `${dateLabel} สิ้นวัน`;
}

function normalizeAssignmentBriefExpectedDeliverables(brief) {
  const source = brief && typeof brief === "object" ? brief : {};
  const explicit = Array.isArray(source.expected_deliverables)
    ? source.expected_deliverables.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (explicit.length) return explicit;
  const derived = [];
  if (Array.isArray(source.shot_list_suggestions) && source.shot_list_suggestions.some((value) => String(value || "").trim())) {
    derived.push("photos", "videos");
  }
  if (Array.isArray(source.caption_suggestions) && source.caption_suggestions.some((value) => String(value || "").trim())) {
    derived.push("caption_draft");
  }
  if (Array.isArray(source.script_suggestions) && source.script_suggestions.some((value) => String(value || "").trim())) {
    derived.push("script_draft");
  }
  if (String(source.brief_summary || "").trim()) {
    derived.push("raw_notes");
  }
  return Array.from(new Set(derived));
}

function deriveExpectedDeliverablesFromFieldPack(fieldPack) {
  const source = fieldPack && typeof fieldPack === "object" ? fieldPack : {};
  const derived = [];
  const checklists = Array.isArray(source.checklists) ? source.checklists : [];
  const hasChecklist = (type) => checklists.some((row) => String(row?.checklist_type || "").trim().toLowerCase() === type && String(row?.item_text || "").trim());

  if (hasChecklist("must_capture")) {
    derived.push("photos", "videos");
  }
  if (hasChecklist("must_verify_fact") || hasChecklist("must_ask_question")) {
    derived.push("raw_notes");
  }
  if (
    Array.isArray(source.social_on_camera_points_json) && source.social_on_camera_points_json.some((value) => String(value || "").trim())
    || String(source.social_hook || "").trim()
  ) {
    derived.push("videos", "script_draft");
  }
  if (String(source.social_caption_angle || "").trim()) {
    derived.push("caption_draft");
  }
  if (String(source.editor_summary || source.ai_summary || "").trim()) {
    derived.push("raw_notes");
  }

  return Array.from(new Set(derived));
}

function uniqueAssignmentBriefStrings(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
}

function getAssignmentBriefPromptGroups(brief = null) {
  const source = brief && typeof brief === "object" ? brief : {};
  const verifiedFacts = uniqueAssignmentBriefStrings(source?.evidence_summary?.verified_facts);
  const nextActions = uniqueAssignmentBriefStrings(source?.next_actions);
  const captureItems = uniqueAssignmentBriefStrings(source?.shot_list_suggestions);
  return {
    mustVerify: verifiedFacts.length ? verifiedFacts : nextActions,
    mustCapture: captureItems,
    mustAsk: nextActions,
  };
}

function renderAssignmentContextBrief(assignment) {
  const node = qs("assignment-context-brief");
  if (!node) return;
  const pageMode = getAssignmentPageMode();
  const fieldPack = state.assignments.contextFieldPack && typeof state.assignments.contextFieldPack === "object"
    ? state.assignments.contextFieldPack
    : null;
  const brief = assignment?.brief_json && typeof assignment.brief_json === "object"
    ? assignment.brief_json
    : null;
  if (!brief && !fieldPack) {
    node.className = "assignment-brief-empty";
    node.innerHTML = "เลือกงานในกระบวนการนี้เพื่อดูคำสั่งงานของงานนี้";
    return;
  }

  const summary = String(brief?.brief_summary || fieldPack?.editor_summary || fieldPack?.ai_summary || "").trim();
  const expectedDeliverables = brief
    ? normalizeAssignmentBriefExpectedDeliverables(brief)
    : normalizeAssignmentBriefExpectedDeliverables({
        expected_deliverables: deriveExpectedDeliverablesFromFieldPack(fieldPack),
      });
  const latestState = assignment ? summarizeAssignment(assignment) : "ยังไม่ได้สร้าง assignment";
  const shouldRenderPromptLists = pageMode !== "work";
  const fieldPrompts = shouldRenderPromptLists ? getFieldPackPromptGroups(fieldPack) : { mustVerify: [], mustCapture: [], mustAsk: [] };

  node.className = "assignment-brief-grid";
  node.innerHTML = `
    <div class="assignment-brief-section full-span">
      <div class="assignment-brief-label">สรุปงานตั้งต้น</div>
      <div class="assignment-brief-text">${summary ? escapeHtml(summary) : '<span class="muted">-</span>'}</div>
    </div>
    <div class="assignment-brief-section">
      <div class="assignment-brief-label">งานที่คาดว่าจะต้องส่ง</div>
      ${formatAssignmentBriefExpectedDeliverables(expectedDeliverables)}
    </div>
    <div class="assignment-brief-section">
      <div class="assignment-brief-label">สถานะงานล่าสุด</div>
      <div class="assignment-brief-text">${escapeHtml(latestState)}</div>
    </div>
    ${shouldRenderPromptLists ? `
      <div class="assignment-brief-section">
        <div class="assignment-brief-label">สิ่งที่ต้องยืนยัน</div>
        ${renderAssignmentBriefList(fieldPrompts.mustVerify, "ยังไม่ได้ระบุ")}
      </div>
      <div class="assignment-brief-section">
        <div class="assignment-brief-label">สิ่งที่ต้องถ่าย</div>
        ${renderAssignmentBriefList(fieldPrompts.mustCapture, "ยังไม่ได้ระบุ")}
      </div>
      <div class="assignment-brief-section full-span">
        <div class="assignment-brief-label">คำถามที่ต้องถาม</div>
        ${renderAssignmentBriefList(fieldPrompts.mustAsk, "ยังไม่ได้ระบุ")}
      </div>
    ` : ""}
  `;
}

function renderAssignmentBriefList(items = [], emptyText = "-") {
  const normalized = Array.isArray(items)
    ? items
      .map((value) => String(value?.prompt || value?.item_text || value || "").trim())
      .filter(Boolean)
    : [];
  if (!normalized.length) {
    return `<div class="assignment-brief-text"><span class="muted">${escapeHtml(emptyText)}</span></div>`;
  }
  return `<ul class="assignment-brief-list">${normalized.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function renderAssignmentBriefReferenceList(items = [], emptyText = "ยังไม่ได้ระบุ") {
  const rows = Array.isArray(items)
    ? items.map((row) => ({
        label: String(row?.label || "").trim(),
        url: String(row?.url || "").trim(),
      })).filter((row) => row.label || row.url)
    : [];
  if (!rows.length) {
    return `<div class="assignment-brief-text"><span class="muted">${escapeHtml(emptyText)}</span></div>`;
  }
  return `<ul class="assignment-brief-list">${rows.map((row) => {
    const label = row.label || row.url || "-";
    if (!row.url) return `<li>${escapeHtml(label)}</li>`;
    return `<li><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`;
  }).join("")}</ul>`;
}

function renderAssignmentSubmissionContext(assignment = null, fieldPack = null) {
  const node = qs("assignment-submission-context");
  if (!node) return;
  const brief = assignment?.brief_json && typeof assignment.brief_json === "object"
    ? assignment.brief_json
    : null;
  if (!assignment || (!fieldPack && !brief)) {
    node.className = "assignment-brief-empty";
    node.innerHTML = "เลือกงานก่อนเพื่อดูข้อมูลประกอบงานในหน้านี้";
    return;
  }
  const summary = String(brief?.brief_summary || fieldPack?.editor_summary || fieldPack?.ai_summary || "").trim();
  const expectedDeliverables = normalizeAssignmentBriefExpectedDeliverables({
    ...(brief || {}),
    expected_deliverables: brief?.expected_deliverables || deriveExpectedDeliverablesFromFieldPack(fieldPack),
  });
  const references = Array.isArray(fieldPack?.references)
    ? fieldPack.references.map((row) => ({
        label: String(row?.label || "").trim(),
        url: String(row?.url || "").trim(),
      }))
    : Array.isArray(brief?.references)
      ? brief.references.map((row) => ({
          label: String(row?.label || "").trim(),
          url: String(row?.url || "").trim(),
        }))
      : [];
  const mediaHints = Array.isArray(fieldPack?.media_hints)
    ? fieldPack.media_hints.map((row) => ({
        label: String(row?.caption || row?.kind || "").trim(),
        url: String(row?.url || "").trim(),
      }))
    : Array.isArray(brief?.media_hints)
      ? brief.media_hints.map((row) => ({
          label: String(row?.caption || row?.kind || "").trim(),
          url: String(row?.url || "").trim(),
        }))
      : [];
  const socialHook = String(fieldPack?.social_hook || brief?.recommended_hook || "").trim();
  const socialCaptionAngle = String(fieldPack?.social_caption_angle || (Array.isArray(brief?.caption_suggestions) ? brief.caption_suggestions[0] : "") || "").trim();
  const onCameraPoints = Array.isArray(fieldPack?.social_on_camera_points_json)
    ? fieldPack.social_on_camera_points_json.map((value) => String(value || "").trim()).filter(Boolean)
    : uniqueAssignmentBriefStrings(brief?.script_suggestions);

  node.className = "assignment-brief-grid";
  node.innerHTML = `
    <div class="assignment-brief-section full-span">
      <div class="assignment-brief-label">สรุปงานตั้งต้น</div>
      <div class="assignment-brief-text">${summary ? escapeHtml(summary) : '<span class="muted">ยังไม่ได้ระบุ</span>'}</div>
    </div>
    <div class="assignment-brief-section full-span">
      <div class="assignment-brief-label">งานที่คาดว่าจะต้องส่ง</div>
      ${formatAssignmentBriefExpectedDeliverables(expectedDeliverables)}
    </div>
    <div class="assignment-brief-section full-span">
      <div class="assignment-brief-label">แนวเล่า / ทิศทางงาน</div>
      <div class="assignment-brief-text"><strong>Hook:</strong> ${socialHook ? escapeHtml(socialHook) : '<span class="muted">-</span>'}</div>
      <div class="assignment-brief-text"><strong>Caption angle:</strong> ${socialCaptionAngle ? escapeHtml(socialCaptionAngle) : '<span class="muted">-</span>'}</div>
      <div class="assignment-brief-label" style="margin-top:8px;">ประเด็นพูดหน้ากล้อง</div>
      ${renderAssignmentBriefList(onCameraPoints, "ยังไม่ได้ระบุ")}
    </div>
    <div class="assignment-brief-section">
      <div class="assignment-brief-label">ข้อมูลอ้างอิง</div>
      ${renderAssignmentBriefReferenceList(references)}
    </div>
    <div class="assignment-brief-section">
      <div class="assignment-brief-label">Media hints</div>
      ${renderAssignmentBriefReferenceList(mediaHints)}
    </div>
  `;
}

function buildAssignmentCaptureUploadCards(assignmentId, capturePrompts = []) {
  const normalizedItems = normalizeAssignmentCaptureUploadItems(capturePrompts);
  if (!normalizedItems.length) {
    return '<div class="assignment-brief-empty">ไม่มีหัวข้อที่ต้องถ่ายในงานนี้</div>';
  }
  const renderPromptCards = (items, mode, sectionTitle, emptyText) => {
    const rows = Array.isArray(items) ? items : [];
    const cards = rows.map((item) => {
      const prompt = String(item?.prompt || "").trim();
      const uploadKey = String(item?.uploadKey || "").trim();
      const files = listAssignmentCaptureFiles(assignmentId, uploadKey);
      const isLoading = isAssignmentCaptureLoading(assignmentId, uploadKey);
      const acceptedPrefix = mode === "video" ? "video/" : "image/";
      const acceptedLabel = mode === "video" ? "วิดีโอ" : "รูป";
      const selectedFiles = files.filter((file) => String(file?.type || "").trim().toLowerCase().startsWith(acceptedPrefix));
      const countLabel = `${selectedFiles.length} ${acceptedLabel}`;
      const fileRows = selectedFiles.length
        ? `<ul class="assignment-brief-list">${selectedFiles.map((file, fileIndex) => {
            const sourceIndex = files.indexOf(file);
            return `<li>${escapeHtml(`${sanitizeUploadFileName(file.name, "upload")} | ${String(file.type || "").trim() || "unknown"}`)} <button type="button" class="step-sub" data-capture-remove-file data-capture-upload-key="${escapeHtml(uploadKey)}" data-capture-file-index="${sourceIndex >= 0 ? sourceIndex : fileIndex}">ลบ</button></li>`;
          }).join("")}</ul>`
        : "";
      return `
        <div class="assignment-brief-section full-span assignment-capture-card" data-capture-upload-key="${escapeHtml(uploadKey)}" data-capture-prompt="${escapeHtml(prompt)}" data-capture-media-type="${escapeHtml(mode)}">
          <div class="assignment-capture-row">
            <div class="assignment-capture-title"><strong>${Number(item?.displayIndex || 0) || 1}.</strong> ${escapeHtml(prompt)}</div>
            <div class="assignment-capture-actions">
              <label class="assignment-capture-upload-button${isLoading ? " is-loading" : ""}">
                <span>${isLoading ? "กำลังเพิ่ม..." : `เลือก${acceptedLabel}`}</span>
                <input data-capture-file-input data-capture-mode="${escapeHtml(mode)}" type="file" accept="${mode}/*" multiple />
              </label>
              <span class="assignment-capture-count-badge">${escapeHtml(countLabel)}</span>
            </div>
          </div>
          ${fileRows ? `<div class="assignment-brief-list-wrap assignment-capture-files">${fileRows}</div>` : ""}
        </div>
      `;
    }).join("");
    return `
      <div class="assignment-brief-section full-span">
        <div class="assignment-brief-label">${escapeHtml(sectionTitle)}</div>
        ${cards || `<div class="assignment-brief-empty">${escapeHtml(emptyText)}</div>`}
      </div>
    `;
  };
  const imagePrompts = normalizedItems.filter((item) => item.mediaType === "image");
  const videoPrompts = normalizedItems.filter((item) => item.mediaType === "video");
  return [
    renderPromptCards(imagePrompts, "image", "กล่องอัปโหลดรูป", "ไม่มีหัวข้อสำหรับอัปโหลดรูป"),
    renderPromptCards(videoPrompts, "video", "กล่องอัปโหลดวิดีโอ", "ไม่มีหัวข้อที่ระบุว่าต้องใช้วิดีโอ"),
  ].join("");
}

function buildAssignmentSubmissionPromptInputs(items = [], groupName, answers = [], placeholderText = "กรอกข้อมูลที่ได้จากหน้างาน") {
  const prompts = Array.isArray(items) ? items.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const answerMap = new Map(
    (Array.isArray(answers) ? answers : [])
      .map((row) => [String(row?.prompt || "").trim(), String(row?.answer || "").trim()])
      .filter(([prompt]) => Boolean(prompt))
  );
  if (!prompts.length) {
    return '<div class="assignment-brief-empty">ไม่มีหัวข้อในส่วนนี้</div>';
  }
  return prompts.map((prompt, index) => `
    <div class="assignment-brief-section" data-assignment-prompt-row="${escapeHtml(groupName)}" data-prompt="${escapeHtml(prompt)}">
      <div class="assignment-brief-text"><strong>${index + 1}. ${escapeHtml(prompt)}</strong></div>
      <textarea data-assignment-prompt-answer rows="3" placeholder="${escapeHtml(placeholderText)}">${escapeHtml(answerMap.get(prompt) || "")}</textarea>
    </div>
  `).join("");
}

function toCaptureSlug(prompt, index) {
  const base = String(prompt || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const normalized = base || `capture-${index + 1}`;
  return `shot-${index + 1}-${normalized}`.slice(0, 48);
}

function normalizeAssignmentCaptureMediaType(value) {
  const mediaType = String(value || "").trim().toLowerCase();
  if (mediaType === "image" || mediaType === "video") return mediaType;
  return "";
}

function buildAssignmentCaptureSlotKey(input) {
  const source = input && typeof input === "object" ? input : {};
  const prompt = source.prompt;
  const itemOrder = source.itemOrder;
  const mediaType = source.mediaType;
  const captureType = source.captureType;
  const baseKey = toCaptureSlug(prompt, Number(itemOrder || 0) || 0);
  const normalizedMediaType = normalizeAssignmentCaptureMediaType(mediaType);
  const normalizedCaptureType = String(captureType || "").trim().toLowerCase();
  if (normalizedCaptureType === "both" && normalizedMediaType) {
    return `${baseKey}--${normalizedMediaType}`;
  }
  return baseKey;
}

function isVideoCapturePrompt(prompt) {
  const text = String(prompt || "").trim().toLowerCase();
  if (!text) return false;
  return /(วิดีโอ|video)/i.test(text);
}

function normalizeAssignmentCaptureUploadItems(captureItems = []) {
  const items = Array.isArray(captureItems) ? captureItems : [];
  const normalized = [];
  items.forEach((rawItem, index) => {
    const source = rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)
      ? rawItem
      : null;
    const prompt = String(source?.prompt || source?.item_text || rawItem || "").trim();
    if (!prompt) return;
    const rawCaptureType = String(source?.captureType || source?.capture_type || "").trim().toLowerCase();
    const captureType = ["photo", "video", "both"].includes(rawCaptureType)
      ? rawCaptureType
      : (isVideoCapturePrompt(prompt) ? "video" : "photo");
    const originalIndex = Number.isFinite(Number(source?.originalIndex))
      ? Number(source.originalIndex)
      : index;
    const itemOrder = Number.isFinite(Number(source?.item_order))
      ? Number(source.item_order)
      : originalIndex;
    const displayIndex = itemOrder + 1;
    const baseItem = {
      prompt,
      originalIndex,
      item_order: itemOrder,
      captureType,
      displayIndex,
    };
    if (captureType === "both") {
      normalized.push({
        ...baseItem,
        mediaType: "image",
        uploadKey: buildAssignmentCaptureSlotKey({ prompt, itemOrder, mediaType: "image", captureType }),
        slotKey: buildAssignmentCaptureSlotKey({ prompt, itemOrder, mediaType: "image", captureType }),
      });
      normalized.push({
        ...baseItem,
        mediaType: "video",
        uploadKey: buildAssignmentCaptureSlotKey({ prompt, itemOrder, mediaType: "video", captureType }),
        slotKey: buildAssignmentCaptureSlotKey({ prompt, itemOrder, mediaType: "video", captureType }),
      });
      return;
    }
    const mediaType = captureType === "video" ? "video" : "image";
    normalized.push({
      ...baseItem,
      mediaType,
      uploadKey: buildAssignmentCaptureSlotKey({ prompt, itemOrder, mediaType, captureType }),
      slotKey: buildAssignmentCaptureSlotKey({ prompt, itemOrder, mediaType, captureType }),
    });
  });
  return normalized;
}

function sanitizeUploadFileName(name, fallback = "upload") {
  const raw = String(name || "").trim() || fallback;
  return raw.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
}

function getAssignmentCaptureUploadBucket(assignmentId, createIfMissing = false) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return null;
  if (!state.assignments.captureUploadDrafts || typeof state.assignments.captureUploadDrafts !== "object") {
    state.assignments.captureUploadDrafts = {};
  }
  if (!state.assignments.captureUploadDrafts[id] && createIfMissing) {
    state.assignments.captureUploadDrafts[id] = {};
  }
  return state.assignments.captureUploadDrafts[id] || null;
}

function listAssignmentCaptureFiles(assignmentId, slug) {
  const bucket = getAssignmentCaptureUploadBucket(assignmentId, false);
  if (!bucket) return [];
  const files = Array.isArray(bucket[slug]) ? bucket[slug] : [];
  return files.filter((file) => file instanceof File);
}

function setAssignmentCaptureFiles(assignmentId, slug, files) {
  const bucket = getAssignmentCaptureUploadBucket(assignmentId, true);
  if (!bucket) return;
  const nextFiles = (Array.isArray(files) ? files : []).filter((file) => file instanceof File);
  bucket[slug] = nextFiles;
}

function appendAssignmentCaptureFiles(assignmentId, slug, files) {
  const current = listAssignmentCaptureFiles(assignmentId, slug);
  const next = current.concat((Array.isArray(files) ? files : []).filter((file) => file instanceof File));
  setAssignmentCaptureFiles(assignmentId, slug, next);
  markAssignmentCaptureUploadsDirty(assignmentId);
}

function removeAssignmentCaptureFile(assignmentId, slug, index) {
  const id = Number(assignmentId || 0) || 0;
  const key = String(slug || "").trim();
  const targetIndex = Number(index);
  if (!id || !key || !Number.isInteger(targetIndex) || targetIndex < 0) return;
  const current = listAssignmentCaptureFiles(id, key);
  if (!current.length || targetIndex >= current.length) return;
  const next = current.filter((_file, i) => i !== targetIndex);
  setAssignmentCaptureFiles(id, key, next);
  markAssignmentCaptureUploadsDirty(id);
}

function getAssignmentCaptureSyncStateBucket(assignmentId, createIfMissing = false) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return null;
  if (!state.assignments.captureUploadSyncState || typeof state.assignments.captureUploadSyncState !== "object") {
    state.assignments.captureUploadSyncState = {};
  }
  if (!state.assignments.captureUploadSyncState[id] && createIfMissing) {
    state.assignments.captureUploadSyncState[id] = {};
  }
  return state.assignments.captureUploadSyncState[id] || null;
}

function buildAssignmentServerAssetSyncSignature(assignmentId, assets = []) {
  const id = Number(assignmentId || 0) || 0;
  if (!id || !Array.isArray(assets) || !assets.length) return "";
  const serialized = assets
    .map((row) => {
      const assetId = Number(row?.id || 0) || 0;
      const fileName = String(row?.file_name || "").trim();
      const mimeType = String(row?.mime_type || "").trim().toLowerCase();
      return `${assetId}|${fileName}|${mimeType}`;
    })
    .sort()
    .join(";");
  return serialized ? `server:${id}:${serialized}` : "";
}

function buildAssignmentCaptureQueueSignature(assignmentId, capturePrompts = []) {
  const queue = buildAssignmentCaptureFileUploadQueue(assignmentId, capturePrompts);
  return queue.map((entry) => {
    const slug = String(entry?.slug || "").trim();
    const file = entry?.file instanceof File ? entry.file : null;
    if (!file) return "";
    return [slug, String(file.name || "").trim(), Number(file.size || 0), String(file.type || "").trim().toLowerCase()].join("|");
  }).join(";");
}

function getAssignmentCaptureSyncKey(assignmentId, capturePrompts = []) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return "";
  const localSignature = buildAssignmentCaptureQueueSignature(id, capturePrompts);
  const syncBucket = getAssignmentCaptureSyncStateBucket(id, false);
  const bucketSignature = String(syncBucket?.signature || "");
  const signature = localSignature || bucketSignature;
  if (!signature) return "";
  return `${id}::${signature}`;
}

const ASSIGNMENT_WORK_SYNC_EXPIRY_MS = 24 * 60 * 60 * 1000;
const ASSIGNMENT_CAPTURE_MAX_IMAGES_PER_SLOT = 5;
const ASSIGNMENT_CAPTURE_MAX_VIDEOS_PER_SLOT = 2;

function createAssignmentSyncBatchId(assignmentId) {
  const id = Number(assignmentId || 0) || 0;
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `assignment-work-${id}-${Date.now()}-${randomPart}`;
}

function getAssignmentServerSyncedAssetsForCaptureItems(assignmentId, captureItems = []) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return { complete: false, assets: [], missing: [], syncSignature: "" };
  const assignment = getAssignmentById(id);
  if (!assignment) return { complete: false, assets: [], missing: [], syncSignature: "" };
  const currentRound = getAssignmentCurrentRound(assignment);
  const normalizedItems = normalizeAssignmentCaptureUploadItems(captureItems);
  if (!normalizedItems.length) return { complete: false, assets: [], missing: [], syncSignature: "" };
  const expectedBySlotTypeKey = new Map();
  normalizedItems.forEach((item) => {
    const slotKey = String(item?.slotKey || item?.uploadKey || "").trim();
    const mediaType = normalizeAssignmentCaptureMediaType(item?.mediaType);
    if (!slotKey || !mediaType) return;
    expectedBySlotTypeKey.set(`${slotKey}|${mediaType}`, item);
  });
  const nowMs = Date.now();
  const rows = Array.isArray(state.assignments.assetLookup) ? state.assignments.assetLookup : [];
  const assignmentRows = rows.filter((row) => {
    if (Number(row?.assignment_id || 0) !== id) return false;
    if (Number(row?.assignment_round || 0) !== currentRound) return false;
    if (String(row?.assignment_surface || "").trim().toLowerCase() !== "assignment_work") return false;
    const slotTypeKey = getAssignmentAssetSlotTypeKeyFromAsset(row);
    return expectedBySlotTypeKey.has(slotTypeKey);
  }).map((row) => ({
    id: Number(row?.id || 0) || null,
    file_name: String(row?.file_name || "").trim() || null,
    mime_type: String(row?.mime_type || "").trim().toLowerCase() || null,
    public_url: String(row?.public_url || "").trim() || null,
    storage_path: String(row?.storage_path || "").trim() || null,
    assignment_id: Number(row?.assignment_id || 0) || null,
    assignment_round: Number(row?.assignment_round || 0) || null,
    assignment_media_type: normalizeAssignmentCaptureMediaType(row?.assignment_media_type) || null,
    assignment_slot_key: String(row?.assignment_slot_key || row?.slotKey || row?.slot_key || "").trim().toLowerCase() || null,
    assignment_surface: String(row?.assignment_surface || "").trim() || null,
    assignment_sync_batch_id: String(row?.assignment_sync_batch_id || "").trim() || null,
    created_at: String(row?.created_at || "").trim() || null,
  }));

  const activeRows = [];
  const expiredRows = [];
  assignmentRows.forEach((row) => {
    const createdAtMs = Date.parse(String(row?.created_at || ""));
    if (Number.isFinite(createdAtMs) && createdAtMs > 0 && (nowMs - createdAtMs) >= ASSIGNMENT_WORK_SYNC_EXPIRY_MS) {
      expiredRows.push(row);
      return;
    }
    activeRows.push(row);
  });

  const groupedBySlotType = new Map();
  for (const row of activeRows) {
    const key = getAssignmentAssetSlotTypeKeyFromAsset(row);
    if (!key) continue;
    if (!groupedBySlotType.has(key)) groupedBySlotType.set(key, []);
    groupedBySlotType.get(key).push(row);
  }
  const effectiveRows = [];
  for (const [key, rowsBySlotType] of groupedBySlotType.entries()) {
    const rowsWithBatch = rowsBySlotType.filter((row) => String(row?.assignment_sync_batch_id || "").trim().length > 0);
    if (rowsWithBatch.length) {
      const batchMap = new Map();
      rowsWithBatch.forEach((row) => {
        const batchId = String(row?.assignment_sync_batch_id || "").trim();
        if (!batchMap.has(batchId)) batchMap.set(batchId, []);
        batchMap.get(batchId).push(row);
      });
      let latestBatchId = "";
      let latestBatchMarker = 0;
      for (const [batchId, batchRows] of batchMap.entries()) {
        const marker = batchRows.reduce((maxId, row) => Math.max(maxId, Number(row?.id || 0) || 0), 0);
        if (marker > latestBatchMarker) {
          latestBatchMarker = marker;
          latestBatchId = batchId;
        }
      }
      const selectedBatchRows = (batchMap.get(latestBatchId) || []).slice().sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
      effectiveRows.push(...selectedBatchRows);
      continue;
    }
    const mediaType = key.endsWith("|video") ? "video" : "image";
    const maxCount = mediaType === "video" ? ASSIGNMENT_CAPTURE_MAX_VIDEOS_PER_SLOT : ASSIGNMENT_CAPTURE_MAX_IMAGES_PER_SLOT;
    const orderedRows = rowsBySlotType.slice().sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
    // TODO: remove fallback once all legacy rows have assignment_sync_batch_id.
    effectiveRows.push(...orderedRows.slice(0, maxCount));
  }

  const requireImages = Boolean(assignment?.image_reset_required);
  const requireVideos = Boolean(assignment?.video_reset_required);
  const countsBySlotTypeKey = new Map();
  effectiveRows.forEach((row) => {
    const slotTypeKey = getAssignmentAssetSlotTypeKeyFromAsset(row);
    if (!slotTypeKey) return;
    countsBySlotTypeKey.set(slotTypeKey, (Number(countsBySlotTypeKey.get(slotTypeKey) || 0) || 0) + 1);
  });

  const missing = [];
  for (const [slotTypeKey, entry] of expectedBySlotTypeKey.entries()) {
    const count = Number(countsBySlotTypeKey.get(slotTypeKey) || 0) || 0;
    if (entry.mediaType === "image" && requireImages && count < 1) missing.push(`รูปหัวข้อ ${entry.displayIndex}: ${entry.prompt}`);
    if (entry.mediaType === "video" && requireVideos && count < 1) missing.push(`วิดีโอหัวข้อ ${entry.displayIndex}: ${entry.prompt}`);
  }
  const complete = requireImages || requireVideos
    ? missing.length === 0
    : effectiveRows.length > 0;
  return {
    complete,
    assets: effectiveRows,
    missing,
    syncSignature: buildAssignmentServerAssetSyncSignature(id, effectiveRows),
    has_expired_assets: expiredRows.length > 0,
    expired_count: expiredRows.length,
  };
}

function getAssignmentAssetSlotTypeKeyFromAsset(asset) {
  const explicitSlotKey = String(asset?.slotKey || asset?.slot_key || asset?.assignment_slot_key || "").trim().toLowerCase();
  const explicitMediaType = normalizeAssignmentCaptureMediaType(
    asset?.mediaType || asset?.media_type || asset?.assignment_media_type
  );
  if (explicitSlotKey && explicitMediaType) return `${explicitSlotKey}|${explicitMediaType}`;
  const fileName = String(asset?.file_name || "").trim();
  const slug = fileName.includes("__") ? fileName.split("__")[0] : "";
  const persistedMediaType = explicitMediaType || normalizeAssignmentCaptureMediaType(asset?.assignment_media_type);
  const mimeType = String(asset?.mime_type || "").trim().toLowerCase();
  const mediaType = persistedMediaType || (mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : "");
  if (!slug || !mediaType) return "";
  return `${slug}|${mediaType}`;
}

function getAssignmentTouchedSlotTypeKeysFromQueue(uploadQueue = []) {
  const touched = new Set();
  (Array.isArray(uploadQueue) ? uploadQueue : []).forEach((entry) => {
    const slug = String(entry?.slug || "").trim();
    const mimeType = String(entry?.file?.type || "").trim().toLowerCase();
    const mediaType = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("video/") ? "video" : "";
    if (slug && mediaType) touched.add(`${slug}|${mediaType}`);
  });
  return touched;
}

function validateAssignmentCaptureRequirementsFromAssets(assignment, captureItems = [], assets = []) {
  const normalizedItems = normalizeAssignmentCaptureUploadItems(captureItems);
  const requireImages = Boolean(assignment?.image_reset_required);
  const requireVideos = Boolean(assignment?.video_reset_required);
  if (!normalizedItems.length || (!requireImages && !requireVideos)) return [];
  const expectedBySlotTypeKey = new Map();
  normalizedItems.forEach((item) => {
    const slotKey = String(item?.slotKey || item?.uploadKey || "").trim();
    const mediaType = normalizeAssignmentCaptureMediaType(item?.mediaType);
    if (!slotKey || !mediaType) return;
    expectedBySlotTypeKey.set(`${slotKey}|${mediaType}`, item);
  });
  const countsBySlotTypeKey = new Map();
  (Array.isArray(assets) ? assets : []).forEach((asset) => {
    const key = getAssignmentAssetSlotTypeKeyFromAsset(asset);
    if (!key) return;
    if (!expectedBySlotTypeKey.has(key)) return;
    countsBySlotTypeKey.set(key, (Number(countsBySlotTypeKey.get(key) || 0) || 0) + 1);
  });
  const missing = [];
  for (const [key, entry] of expectedBySlotTypeKey.entries()) {
    const count = Number(countsBySlotTypeKey.get(key) || 0) || 0;
    if (entry.mediaType === "image" && requireImages && count < 1) missing.push(`รูปหัวข้อ ${entry.displayIndex}: ${entry.prompt}`);
    if (entry.mediaType === "video" && requireVideos && count < 1) missing.push(`วิดีโอหัวข้อ ${entry.displayIndex}: ${entry.prompt}`);
  }
  return missing;
}

function buildAssignmentCaptureItemLookup(captureItems = []) {
  const lookup = new Map();
  normalizeAssignmentCaptureUploadItems(captureItems).forEach((item) => {
    const slotKey = String(item?.slotKey || item?.uploadKey || "").trim();
    if (slotKey) lookup.set(slotKey, item);
  });
  return lookup;
}

function resolveAssignmentSubmissionEffectiveMedia(assignmentId, captureItems = [], options = {}) {
  const id = Number(assignmentId || 0) || 0;
  const assignment = getAssignmentById(id);
  const uploadQueue = Array.isArray(options.uploadQueue)
    ? options.uploadQueue
    : buildAssignmentCaptureFileUploadQueue(id, captureItems);
  const hasLocalQueue = uploadQueue.length > 0;
  const syncKey = getAssignmentCaptureSyncKey(id, captureItems);
  const strict = options?.strict === true;
  const serverSynced = getAssignmentServerSyncedAssetsForCaptureItems(id, captureItems);
  const bundle = Number(state.assignments.deliverablesBundle?.assignment_id || 0) === id
    ? state.assignments.deliverablesBundle
    : null;
  const latestSubmission = assignment ? getLatestAssignmentSubmissionRow(assignment) : null;
  const requireImages = Boolean(assignment?.image_reset_required);
  const requireVideos = Boolean(assignment?.video_reset_required);
  const identityForAsset = (asset) => {
    const assetId = Number(asset?.id || 0) || 0;
    if (assetId > 0) return `id:${assetId}`;
    const stableUrl = String(asset?.public_url || asset?.source_url || asset?.storage_path || "").trim().toLowerCase();
    if (stableUrl) return `url:${stableUrl}`;
    const slotTypeKey = getAssignmentAssetSlotTypeKeyFromAsset(asset);
    const fileName = String(asset?.file_name || "").trim().toLowerCase();
    if (slotTypeKey && fileName) return `slot:${slotTypeKey}|file:${fileName}`;
    if (slotTypeKey) return `slot:${slotTypeKey}`;
    return fileName ? `file:${fileName}` : "";
  };
  const pushUnique = (target, seenKeys, asset) => {
    if (!asset || typeof asset !== "object") return;
    const key = identityForAsset(asset);
    if (key && seenKeys.has(key)) return;
    if (key) seenKeys.add(key);
    target.push(asset);
  };
  const normalizeResolvedAsset = (asset, fallbackMediaType = "") => {
    if (!asset || typeof asset !== "object") return null;
    return {
      id: Number(asset?.id || 0) || null,
      file_name: String(asset?.file_name || "").trim() || null,
      mime_type: String(asset?.mime_type || "").trim().toLowerCase() || null,
      public_url: String(asset?.public_url || asset?.source_url || "").trim() || null,
      storage_path: String(asset?.storage_path || "").trim() || null,
      assignment_id: Number(asset?.assignment_id || 0) || null,
      assignment_round: Number(asset?.assignment_round || 0) || null,
      assignment_media_type: normalizeAssignmentCaptureMediaType(
        asset?.assignment_media_type || asset?.mediaType || asset?.media_type || fallbackMediaType
      ) || null,
      assignment_slot_key: String(asset?.assignment_slot_key || asset?.slotKey || asset?.slot_key || "").trim().toLowerCase() || null,
      assignment_surface: String(asset?.assignment_surface || "").trim() || null,
      assignment_sync_batch_id: String(asset?.assignment_sync_batch_id || "").trim() || null,
      created_at: String(asset?.created_at || "").trim() || null,
    };
  };
  const retainedAssets = [];
  const retainedSeenKeys = new Set();
  const appendRetainedFromBundle = (deliverableType, mediaType) => {
    const rows = Array.isArray(bundle?.deliverables_by_type?.[deliverableType])
      ? bundle.deliverables_by_type[deliverableType]
      : [];
    if (mediaType === "image" && requireImages) return rows.length > 0;
    if (mediaType === "video" && requireVideos) return rows.length > 0;
    rows.forEach((row, index) => {
      const linkedAsset = findAssignmentAssetById(row?.source_asset_id);
      if (linkedAsset) {
        pushUnique(retainedAssets, retainedSeenKeys, normalizeResolvedAsset(linkedAsset, mediaType));
        return;
      }
      const sourceUrl = String(row?.source_url || "").trim();
      if (!sourceUrl) return;
      pushUnique(retainedAssets, retainedSeenKeys, normalizeResolvedAsset({
        id: null,
        file_name: String(row?.title || "").trim() || `${deliverableType}-${index + 1}`,
        mime_type: mediaType === "video" ? "video/mp4" : "image/jpeg",
        public_url: sourceUrl,
        assignment_id: id,
        assignment_round: Number(assignment?.revision_round || 0) || null,
        assignment_media_type: mediaType,
        created_at: row?.created_at || row?.updated_at || null,
      }, mediaType));
    });
    return rows.length > 0;
  };
  const appendRetainedFromPayloadFallback = (mediaType) => {
    if (mediaType === "image" && requireImages) return;
    if (mediaType === "video" && requireVideos) return;
    const payloadAssets = Array.isArray(latestSubmission?.media_payload_json?.assets)
      ? latestSubmission.media_payload_json.assets
      : [];
    payloadAssets
      .filter((asset) => {
        const mimeType = String(asset?.mime_type || "").trim().toLowerCase();
        return mediaType === "video" ? mimeType.startsWith("video/") : mimeType.startsWith("image/");
      })
      .forEach((asset) => {
        pushUnique(retainedAssets, retainedSeenKeys, normalizeResolvedAsset(asset, mediaType));
      });
  };
  const hasBundlePhotos = appendRetainedFromBundle("photos", "image");
  const hasBundleVideos = appendRetainedFromBundle("videos", "video");
  if (!hasBundlePhotos) appendRetainedFromPayloadFallback("image");
  if (!hasBundleVideos) appendRetainedFromPayloadFallback("video");

  if (!hasLocalQueue) {
    const effectiveAssets = [];
    const effectiveSeenKeys = new Set();
    (Array.isArray(serverSynced.assets) ? serverSynced.assets : []).forEach((asset) => pushUnique(effectiveAssets, effectiveSeenKeys, asset));
    retainedAssets.forEach((asset) => pushUnique(effectiveAssets, effectiveSeenKeys, asset));
    return {
      assets: effectiveAssets,
      payloadAssets: [],
      retainedAssets,
      missing: validateAssignmentCaptureRequirementsFromAssets(assignment, captureItems, effectiveAssets),
      hasLocalQueue,
      syncKey,
      serverSynced,
      touchedKeys: new Set(),
    };
  }

  if (!isAssignmentCaptureUploadsSynced(id, captureItems)) {
    if (strict) {
      throw new Error("ต้องทำขั้นที่ 1: อัปโหลด/ซิงก์ไฟล์ชุดที่เลือกในเครื่องให้ครบก่อนทำขั้นที่ 2: ส่งงานกลับ");
    }
    return {
      assets: [],
      payloadAssets: [],
      retainedAssets,
      missing: [],
      hasLocalQueue,
      syncKey,
      serverSynced,
      touchedKeys: getAssignmentTouchedSlotTypeKeysFromQueue(uploadQueue),
      blockedMessage: "ต้องทำขั้นที่ 1: อัปโหลด/ซิงก์ไฟล์ชุดที่เลือกในเครื่องให้ครบก่อนทำขั้นที่ 2: ส่งงานกลับ",
    };
  }

  const cachedSyncedAssets = getSyncedUploadAssetsForKey(syncKey);
  const latestKey = String(state.assignments.latestUploadedAssetsKey || "");
  const latestAssets = Array.isArray(state.assignments.latestUploadedAssets) ? state.assignments.latestUploadedAssets : [];
  const localSyncedAssets = cachedSyncedAssets.length ? cachedSyncedAssets : (latestKey === syncKey ? latestAssets : []);
  if (!localSyncedAssets.length) {
    if (strict) {
      throw new Error("พบสถานะซิงก์ไฟล์เดิม แต่ไม่พบรายการไฟล์ที่ซิงก์ในหน้านี้ กรุณากดอัปโหลด/ซิงก์ไฟล์อีกครั้ง");
    }
    return {
      assets: [],
      payloadAssets: [],
      retainedAssets,
      missing: [],
      hasLocalQueue,
      syncKey,
      serverSynced,
      touchedKeys: getAssignmentTouchedSlotTypeKeysFromQueue(uploadQueue),
      blockedMessage: "พบสถานะซิงก์ไฟล์เดิม แต่ไม่พบรายการไฟล์ที่ซิงก์ในหน้านี้ กรุณากดอัปโหลด/ซิงก์ไฟล์อีกครั้ง",
    };
  }

  const touchedKeys = getAssignmentTouchedSlotTypeKeysFromQueue(uploadQueue);
  const localByKey = new Map();
  localSyncedAssets.forEach((asset) => {
    const key = getAssignmentAssetSlotTypeKeyFromAsset(asset);
    if (!key) return;
    if (!localByKey.has(key)) localByKey.set(key, []);
    localByKey.get(key).push(asset);
  });
  for (const key of touchedKeys) {
    if (localByKey.has(key)) continue;
    if (strict) {
      throw new Error("พบสถานะซิงก์ไฟล์เดิม แต่ไม่พบรายการไฟล์ที่ซิงก์ในหน้านี้ กรุณากดอัปโหลด/ซิงก์ไฟล์อีกครั้ง");
    }
  }

  const serverByKey = new Map();
  (Array.isArray(serverSynced.assets) ? serverSynced.assets : []).forEach((asset) => {
    const key = getAssignmentAssetSlotTypeKeyFromAsset(asset);
    if (!key) return;
    if (!serverByKey.has(key)) serverByKey.set(key, []);
    serverByKey.get(key).push(asset);
  });
  const effectiveAssets = [];
  const payloadAssets = [];
  const effectiveSeenKeys = new Set();
  const payloadSeenKeys = new Set();
  for (const key of touchedKeys) {
    const rows = localByKey.get(key) || [];
    rows.forEach((asset) => {
      pushUnique(effectiveAssets, effectiveSeenKeys, asset);
      pushUnique(payloadAssets, payloadSeenKeys, asset);
    });
  }
  for (const [key, rows] of serverByKey.entries()) {
    if (touchedKeys.has(key)) continue;
    rows.forEach((asset) => pushUnique(effectiveAssets, effectiveSeenKeys, asset));
  }
  retainedAssets.forEach((asset) => {
    const slotTypeKey = getAssignmentAssetSlotTypeKeyFromAsset(asset);
    if (slotTypeKey && (touchedKeys.has(slotTypeKey) || serverByKey.has(slotTypeKey))) return;
    pushUnique(effectiveAssets, effectiveSeenKeys, asset);
  });

  return {
    assets: effectiveAssets,
    payloadAssets,
    retainedAssets,
    missing: validateAssignmentCaptureRequirementsFromAssets(assignment, captureItems, effectiveAssets),
    hasLocalQueue,
    syncKey,
    serverSynced,
    touchedKeys,
  };
}

function composeAssignmentSubmissionEffectiveAssets(assignmentId, captureItems = [], options = {}) {
  return resolveAssignmentSubmissionEffectiveMedia(assignmentId, captureItems, options);
}

function applyAssignmentServerSyncedAssets(assignmentId, captureItems = [], options = {}) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return { complete: false, assets: [], missing: [] };
  const result = getAssignmentServerSyncedAssetsForCaptureItems(id, captureItems);
  if (!result.complete || !result.assets.length || !result.syncSignature) return result;
  const localQueue = buildAssignmentCaptureFileUploadQueue(id, captureItems);
  if (localQueue.length > 0) {
    // Local selected files take precedence; do not overwrite sync signature/cache from server state.
    return result;
  }
  const syncBucket = getAssignmentCaptureSyncStateBucket(id, true);
  if (!syncBucket) return result;
  syncBucket.signature = result.syncSignature;
  syncBucket.syncedAt = new Date().toISOString();
  syncBucket.uploadedCount = result.assets.length;
  const syncKey = getAssignmentCaptureSyncKey(id, captureItems);
  setLatestUploadedAssetsForSyncKey(syncKey, result.assets);
  if (options?.showStatus) {
    setStatus("assignment-status", `มีไฟล์ที่ซิงก์แล้วบน server รอส่งงานกลับ | ซิงก์แล้ว ${result.assets.length} ไฟล์`);
  }
  return result;
}

function getSyncedUploadAssetsForKey(syncKey) {
  const key = String(syncKey || "").trim();
  if (!key) return [];
  const bucket = state.assignments.syncedUploadAssetsByKey;
  if (!bucket || typeof bucket !== "object") return [];
  const assets = bucket[key];
  return Array.isArray(assets) ? assets : [];
}

function setLatestUploadedAssetsForSyncKey(syncKey, uploadedAssets = []) {
  const key = String(syncKey || "").trim();
  const nextAssets = Array.isArray(uploadedAssets) ? uploadedAssets : [];
  state.assignments.latestUploadedAssets = nextAssets;
  state.assignments.latestUploadedAssetsKey = key;
  if (key) {
    if (!state.assignments.syncedUploadAssetsByKey || typeof state.assignments.syncedUploadAssetsByKey !== "object") {
      state.assignments.syncedUploadAssetsByKey = {};
    }
    state.assignments.syncedUploadAssetsByKey[key] = nextAssets;
  }
}

function clearSyncedUploadAssetsCacheForAssignment(assignmentId) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return;
  const bucket = state.assignments.syncedUploadAssetsByKey;
  if (!bucket || typeof bucket !== "object") return;
  const prefix = `${id}::`;
  Object.keys(bucket).forEach((key) => {
    if (String(key || "").startsWith(prefix)) delete bucket[key];
  });
}

function markAssignmentCaptureUploadsDirty(assignmentId) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return;
  const syncBucket = getAssignmentCaptureSyncStateBucket(id, false);
  if (syncBucket) {
    const priorSignature = String(syncBucket.signature || "");
    if (priorSignature) {
      const priorKey = `${id}::${priorSignature}`;
      if (
        state.assignments.syncedUploadAssetsByKey
        && typeof state.assignments.syncedUploadAssetsByKey === "object"
      ) {
        delete state.assignments.syncedUploadAssetsByKey[priorKey];
      }
      if (String(state.assignments.latestUploadedAssetsKey || "") === priorKey) {
        state.assignments.latestUploadedAssets = [];
        state.assignments.latestUploadedAssetsKey = "";
      }
    }
    delete syncBucket.signature;
    delete syncBucket.syncedAt;
    delete syncBucket.uploadedCount;
  }
}

function markAssignmentCaptureUploadsSynced(assignmentId, capturePrompts = [], uploadedAssets = []) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return;
  const syncBucket = getAssignmentCaptureSyncStateBucket(id, true);
  if (!syncBucket) return;
  syncBucket.signature = buildAssignmentCaptureQueueSignature(id, capturePrompts);
  syncBucket.syncedAt = new Date().toISOString();
  syncBucket.uploadedCount = Array.isArray(uploadedAssets) ? uploadedAssets.length : 0;
  const syncKey = getAssignmentCaptureSyncKey(id, capturePrompts);
  setLatestUploadedAssetsForSyncKey(syncKey, uploadedAssets);
}

function isAssignmentCaptureUploadsSynced(assignmentId, capturePrompts = []) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return false;
  const syncBucket = getAssignmentCaptureSyncStateBucket(id, false);
  if (!syncBucket || !syncBucket.signature) return false;
  const currentSignature = buildAssignmentCaptureQueueSignature(id, capturePrompts);
  return currentSignature.length > 0 && currentSignature === String(syncBucket.signature || "");
}

function getAssignmentCaptureLoadingBucket(assignmentId, createIfMissing = false) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return null;
  if (!state.assignments.captureUploadLoading || typeof state.assignments.captureUploadLoading !== "object") {
    state.assignments.captureUploadLoading = {};
  }
  if (!state.assignments.captureUploadLoading[id] && createIfMissing) {
    state.assignments.captureUploadLoading[id] = {};
  }
  return state.assignments.captureUploadLoading[id] || null;
}

function isAssignmentCaptureLoading(assignmentId, slug) {
  const bucket = getAssignmentCaptureLoadingBucket(assignmentId, false);
  if (!bucket) return false;
  return bucket[String(slug || "").trim()] === true;
}

function setAssignmentCaptureLoading(assignmentId, slug, isLoading) {
  const key = String(slug || "").trim();
  if (!key) return;
  if (isLoading) {
    const bucket = getAssignmentCaptureLoadingBucket(assignmentId, true);
    if (bucket) bucket[key] = true;
    return;
  }
  const bucket = getAssignmentCaptureLoadingBucket(assignmentId, false);
  if (!bucket) return;
  delete bucket[key];
}

function clearAssignmentCaptureUploads(assignmentId) {
  const id = Number(assignmentId || 0) || 0;
  if (!id || !state.assignments.captureUploadDrafts || typeof state.assignments.captureUploadDrafts !== "object") return;
  delete state.assignments.captureUploadDrafts[id];
  if (state.assignments.captureUploadLoading && typeof state.assignments.captureUploadLoading === "object") {
    delete state.assignments.captureUploadLoading[id];
  }
  if (state.assignments.captureUploadSyncState && typeof state.assignments.captureUploadSyncState === "object") {
    delete state.assignments.captureUploadSyncState[id];
  }
  clearSyncedUploadAssetsCacheForAssignment(id);
  if (String(state.assignments.latestUploadedAssetsKey || "").startsWith(`${id}::`)) {
    state.assignments.latestUploadedAssets = [];
    state.assignments.latestUploadedAssetsKey = "";
  }
}

function renderAssignmentSubmissionFileList() {
  const node = qs("assignment-submission-file-list");
  if (!node) return;
  const assignmentId = Number(state.assignments.selectedId || 0) || 0;
  const assignment = getAssignmentById(assignmentId);
  const formConfig = getAssignmentSubmissionFormConfig(assignment, state.assignments.contextFieldPack);
  const captureBucket = getAssignmentCaptureUploadBucket(assignmentId, false) || {};
  const files = Object.values(captureBucket).flatMap((rows) => (Array.isArray(rows) ? rows : [])).filter((file) => file instanceof File);
  const hasLocalQueue = buildAssignmentCaptureFileUploadQueue(assignmentId, formConfig.captureItems).length > 0;
  const uploadQueue = buildAssignmentCaptureFileUploadQueue(assignmentId, formConfig.captureItems);
  const composed = composeAssignmentSubmissionEffectiveAssets(assignmentId, formConfig.captureItems, { uploadQueue, strict: false });
  const uploadedAssets = Array.isArray(composed?.assets) ? composed.assets : [];
  const isSynced = isAssignmentCaptureUploadsSynced(assignmentId, formConfig.captureItems);
  const retainedOnly = !hasLocalQueue
    && Array.isArray(composed?.retainedAssets)
    && composed.retainedAssets.length > 0
    && Array.isArray(composed?.payloadAssets)
    && composed.payloadAssets.length === 0;
  if (isSynced && uploadedAssets.length) {
    node.className = "assignment-brief-list-wrap";
    node.innerHTML = `
      <div class="assignment-brief-meta" style="margin-bottom:8px;">มีไฟล์ที่ซิงก์แล้วบน server รอส่งงานกลับ | ซิงก์แล้ว ${uploadedAssets.length} ไฟล์</div>
      <ul class="assignment-brief-list">
        ${uploadedAssets.map((asset) => {
          const label = escapeHtml(`${String(asset?.file_name || "").trim() || `asset-${Number(asset?.id || 0)}`} | ${String(asset?.mime_type || "").trim() || "unknown"}`);
          const publicUrl = String(asset?.public_url || "").trim();
          return `<li>${publicUrl ? `<a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label}</li>`;
        }).join("")}
      </ul>
    `;
    return;
  }
  if (!files.length) {
    if (uploadedAssets.length) {
      node.className = "assignment-brief-list-wrap";
      node.innerHTML = `
        <div class="assignment-brief-meta" style="margin-bottom:8px;">${retainedOnly ? `มีไฟล์เดิมจากรอบล่าสุดพร้อมส่งงานกลับ ${uploadedAssets.length} ไฟล์` : (isSynced ? `มีไฟล์ที่ซิงก์แล้วบน server รอส่งงานกลับ | ซิงก์แล้ว ${uploadedAssets.length} ไฟล์` : `อัปโหลดเข้าระบบแล้ว ${uploadedAssets.length} ไฟล์`)}</div>
        <ul class="assignment-brief-list">
          ${uploadedAssets.map((asset) => {
            const label = escapeHtml(`${String(asset?.file_name || "").trim() || `asset-${Number(asset?.id || 0)}`} | ${String(asset?.mime_type || "").trim() || "unknown"}`);
            const publicUrl = String(asset?.public_url || "").trim();
            return `<li>${publicUrl ? `<a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label}</li>`;
          }).join("")}
        </ul>
      `;
      return;
    }
    node.className = "assignment-deliverables-empty";
    node.textContent = "ยังไม่ได้เลือกรูปหรือวิดีโอ";
    return;
  }
  node.className = "assignment-brief-list-wrap";
  node.innerHTML = `
    <div class="assignment-brief-meta" style="margin-bottom:8px;">${isSynced ? "สถานะ: ไฟล์ซิงก์แล้ว รอส่งงานกลับ (ขั้นที่ 2)" : (hasLocalQueue ? "มีไฟล์ที่เลือกใหม่ ต้องทำขั้นที่ 1: อัปโหลด/ซิงก์ไฟล์ก่อนส่งงานกลับ" : "สถานะ: ยังไม่ซิงก์ไฟล์ (ต้องทำขั้นที่ 1 ก่อนส่งงานกลับ)")}</div>
    <ul class="assignment-brief-list">${files.map((file) => `<li>${escapeHtml(`${String(file.name || "").trim() || "file"} | ${String(file.type || "").trim() || "unknown"}`)}</li>`).join("")}</ul>
  `;
}

function renderAssignmentSubmissionForm(assignment = null) {
  const workspaceHelpNode = qs("assignment-submission-workspace-help");
  const briefLabelNode = qs("assignment-submission-brief-label");
  const verifiedLabelNode = qs("assignment-submission-verified-label");
  const questionLabelNode = qs("assignment-submission-question-label");
  const requestedChecksWrapNode = qs("assignment-submission-requested-checks-wrap");
  const requestedChecksLabelNode = qs("assignment-submission-requested-checks-label");
  const requestedChecksNode = qs("assignment-submission-requested-checks-fields");
  const captureLabelNode = qs("assignment-submission-capture-label");
  const additionalLabelNode = qs("assignment-submission-additional-label");
  const filesLabelNode = qs("assignment-submission-files-label");
  const verifiedNode = qs("assignment-submission-verified-fields");
  const questionNode = qs("assignment-submission-question-fields");
  const captureNode = qs("assignment-submission-capture-guide");
  const resetNoticeNode = qs("assignment-submission-reset-notice");
  const submitCalloutNode = qs("assignment-submit-callout");
  const briefLink = qs("assignment-submission-brief-link");
  const additionalText = qs("assignment-submission-additional-text");
  const itemId = Number(assignment?.content_item_id || state.assignments.contextItemId || getAssignmentLandingItemId() || 0) || 0;
  const fieldPack = state.assignments.contextFieldPack && typeof state.assignments.contextFieldPack === "object"
    ? state.assignments.contextFieldPack
    : null;
  if (!verifiedNode || !questionNode || !captureNode) return;
  const formConfig = getAssignmentSubmissionFormConfig(assignment, fieldPack);
  if (resetNoticeNode) {
    const messages = [];
    if (assignment?.image_reset_required) {
      messages.push("รูปเดิมถูกรีเซ็ต ต้องอัปโหลดรูปใหม่ก่อนส่งงานกลับ");
    }
    if (assignment?.video_reset_required) {
      messages.push("วิดีโอเดิมถูกรีเซ็ต ต้องอัปโหลดวิดีโอใหม่ก่อนส่งงานกลับ");
    }
    if (messages.length) {
      resetNoticeNode.classList.remove("hidden");
      resetNoticeNode.className = "assignment-brief-card";
      resetNoticeNode.innerHTML = `<div class="assignment-brief-text"><strong>เงื่อนไขรอบแก้:</strong> ${escapeHtml(messages.join(" | "))}</div>`;
    } else {
      resetNoticeNode.className = "hidden";
      resetNoticeNode.innerHTML = "";
    }
  }
  if (workspaceHelpNode) workspaceHelpNode.textContent = formConfig.workspaceHelp;
  const syncUploadButton = qs("btn-assignment-sync-upload");
  if (syncUploadButton) syncUploadButton.textContent = "ขั้นที่ 1: อัปโหลด/ซิงก์ไฟล์";
  const submitButton = qs("btn-assignment-submit");
  if (submitButton) submitButton.textContent = "ขั้นที่ 2: ส่งงานกลับ";
  if (briefLabelNode) briefLabelNode.textContent = formConfig.briefLabel;
  if (verifiedLabelNode) verifiedLabelNode.textContent = formConfig.verifiedLabel;
  if (questionLabelNode) questionLabelNode.textContent = formConfig.questionLabel;
  if (requestedChecksLabelNode) requestedChecksLabelNode.textContent = "คำตอบตามรายการที่ขอ";
  if (captureLabelNode) captureLabelNode.textContent = formConfig.captureLabel;
  if (additionalLabelNode) additionalLabelNode.textContent = formConfig.additionalLabel;
  if (filesLabelNode) filesLabelNode.textContent = formConfig.filesLabel;
  if (additionalText) additionalText.placeholder = formConfig.additionalPlaceholder;
  renderAssignmentSubmissionContext(assignment, fieldPack);
  const brief = assignment?.brief_json && typeof assignment.brief_json === "object"
    ? assignment.brief_json
    : null;

  if (!assignment || (!fieldPack && !brief)) {
    verifiedNode.className = "assignment-brief-empty";
    verifiedNode.innerHTML = formConfig.emptyVerified;
    questionNode.className = "assignment-brief-empty";
    questionNode.innerHTML = formConfig.emptyQuestion;
    if (requestedChecksWrapNode) requestedChecksWrapNode.classList.add("hidden");
    if (requestedChecksNode) {
      requestedChecksNode.className = "assignment-brief-empty";
      requestedChecksNode.innerHTML = "เลือกงานก่อนเพื่อดูรายการที่ขอจากชุดส่งงาน";
    }
    captureNode.className = "assignment-brief-empty";
    captureNode.innerHTML = formConfig.emptyCapture;
    if (briefLink) {
      briefLink.href = buildAssignmentBriefUrl(itemId, Number(assignment?.id || state.assignments.selectedId || 0) || 0);
      briefLink.classList.add("disabled");
      briefLink.setAttribute("aria-disabled", "true");
    }
    if (additionalText) additionalText.value = "";
    setAssignmentDraftSaveStatus("");
    clearAssignmentCaptureUploads(state.assignments.selectedId);
    state.assignments.latestUploadedAssets = [];
    state.assignments.latestUploadedAssetsKey = "";
    renderAssignmentSubmissionFileList();
    renderAssignmentSubmissionGatePanel(null);
    return;
  }

  const articlePayload = getAssignmentSubmissionPrefillPayload(assignment, fieldPack);
  const assignmentId = Number(assignment?.id || state.assignments.selectedId || 0) || 0;
  const cachedHandoffPackage = assignmentId > 0 ? state.assignments.handoffSourcePackages?.[assignmentId] || null : null;
  const handoffPackageState = cachedHandoffPackage && typeof cachedHandoffPackage === "object"
    ? cachedHandoffPackage
    : null;
  renderAssignmentRequestedCheckSection(assignment, handoffPackageState);
  verifiedNode.className = "assignment-brief-grid";
  verifiedNode.innerHTML = buildAssignmentSubmissionPromptInputs(
    formConfig.verifiedPrompts,
    formConfig.verifiedGroupName,
    articlePayload[formConfig.verifiedAnswers],
    formConfig.answerPlaceholder
  );
  questionNode.className = "assignment-brief-grid";
  questionNode.innerHTML = buildAssignmentSubmissionPromptInputs(
    formConfig.questionPrompts,
    formConfig.questionGroupName,
    articlePayload[formConfig.questionAnswers],
    formConfig.answerPlaceholder
  );
  captureNode.className = "assignment-brief-grid";
  captureNode.innerHTML = buildAssignmentCaptureUploadCards(
    Number(assignment?.id || state.assignments.selectedId || 0) || 0,
    formConfig.captureItems
  );
  if (briefLink) {
    briefLink.href = buildAssignmentBriefUrl(itemId, Number(assignment?.id || state.assignments.selectedId || 0) || 0);
    briefLink.classList.toggle("disabled", !(itemId > 0));
    if (itemId > 0) {
      briefLink.removeAttribute("aria-disabled");
    } else {
      briefLink.setAttribute("aria-disabled", "true");
    }
  }
  if (additionalText) {
    additionalText.value = articlePayload.additional_text || "";
  }
  renderAssignmentSubmissionFileList();
  if (submitCalloutNode) {
    const gateState = buildAssignmentSubmissionGateState(
      Number(assignment?.id || state.assignments.selectedId || 0) || 0,
      formConfig,
      { articlePayload }
    );
    renderAssignmentSubmissionGatePanel(gateState);
  }
  applyAssignmentModernClasses();
}

function renderAssignmentRequestedCheckSection(assignment = null, handoffPackage = null, draft = undefined) {
  const requestedChecksWrapNode = qs("assignment-submission-requested-checks-wrap");
  const requestedChecksNode = qs("assignment-submission-requested-checks-fields");
  const assignmentId = Number(assignment?.id || state.assignments.selectedId || 0) || 0;
  if (!requestedChecksNode) return null;
  const requestedCheckGroups = getAssignmentRequestedCheckGroupsFromHandoffPackage(handoffPackage);
  const handoffLoadState = assignmentId > 0 ? state.assignments.handoffSourceLoaded?.[assignmentId] : null;
  const normalizedDraft = requestedCheckGroups.length
    ? (draft === undefined ? getAssignmentRequestedCheckReturnDraftPrefill(assignment, handoffPackage) : normalizeAssignmentRequestedCheckReturnDraft(draft, handoffPackage))
    : null;
  const requestedCheckSectionHtml = requestedCheckGroups.length
    ? buildAssignmentRequestedCheckReturnSectionHtml(assignment, handoffPackage, normalizedDraft)
    : "";
  if (requestedChecksWrapNode) {
    const shouldShowRequestedChecksLoading = !requestedCheckSectionHtml
      && assignmentId > 0
      && handoffLoadState !== true
      && !handoffLoadState
      && !isEditorUser();
    requestedChecksWrapNode.classList.toggle("hidden", !requestedCheckSectionHtml && !shouldShowRequestedChecksLoading);
  }
  if (!requestedCheckSectionHtml) {
    if (assignmentId > 0 && handoffLoadState !== true && !handoffLoadState && !isEditorUser()) {
      requestedChecksNode.className = "assignment-brief-empty";
      requestedChecksNode.innerHTML = "กำลังโหลดรายการที่ขอจากชุดส่งงาน...";
      loadAssignmentRequestedCheckHandoffSource(assignment).catch(() => {});
    } else {
      requestedChecksNode.className = "assignment-brief-grid";
      requestedChecksNode.innerHTML = "";
    }
    return null;
  }
  const source = state.assignments.requestedCheckReturnDraftDirty?.[assignmentId] === true
    ? "user_edit"
    : (
      state.assignments.requestedCheckReturnDraftSources?.[assignmentId]
      || (
        hasUsableAssignmentRequestedCheckReturnRows({ requested_check_returns: normalizedDraft?.requested_check_returns })
          ? "schema_default"
          : null
      )
    );
  setAssignmentRequestedCheckReturnDraftState(assignmentId, normalizedDraft, {
    source,
    dirty: state.assignments.requestedCheckReturnDraftDirty?.[assignmentId] === true,
  });
  requestedChecksNode.className = "assignment-brief-grid";
  requestedChecksNode.innerHTML = requestedCheckSectionHtml;
  requestedChecksNode.querySelectorAll("[data-requested-check-row]").forEach((rowNode) => updateAssignmentRequestedCheckReturnRowState(rowNode));
  return normalizedDraft;
}

function readAssignmentSubmissionPromptAnswers(groupName) {
  return Array.from(document.querySelectorAll(`[data-assignment-prompt-row="${groupName}"]`))
    .map((row) => {
      const prompt = String(row.getAttribute("data-prompt") || "").trim();
      const answer = String(row.querySelector("[data-assignment-prompt-answer]")?.value || "").trim();
      return prompt ? { prompt, answer } : null;
    })
    .filter(Boolean);
}

function getAssignmentSubmissionMissingTextPrompts(formConfig, articlePayload = null) {
  const payload = articlePayload && typeof articlePayload === "object"
    ? articlePayload
    : buildAssignmentSubmissionArticlePayload();
  const answerMap = new Map();
  const verifiedAnswers = Array.isArray(payload?.[formConfig.verifiedAnswers]) ? payload[formConfig.verifiedAnswers] : [];
  const questionAnswers = Array.isArray(payload?.[formConfig.questionAnswers]) ? payload[formConfig.questionAnswers] : [];
  verifiedAnswers.forEach((row) => {
    const prompt = String(row?.prompt || "").trim();
    if (prompt) answerMap.set(prompt, String(row?.answer || "").trim());
  });
  questionAnswers.forEach((row) => {
    const prompt = String(row?.prompt || "").trim();
    if (prompt) answerMap.set(prompt, String(row?.answer || "").trim());
  });
  const missing = [];
  formConfig.verifiedPrompts.forEach((prompt) => {
    const text = String(prompt || "").trim();
    if (text && !String(answerMap.get(text) || "").trim()) missing.push(text);
  });
  formConfig.questionPrompts.forEach((prompt) => {
    const text = String(prompt || "").trim();
    if (text && !String(answerMap.get(text) || "").trim()) missing.push(text);
  });
  if (!String(payload?.additional_text || "").trim()) {
    missing.push("ข้อความเพิ่มเติม");
  }
  return missing;
}

function buildAssignmentSubmissionGateState(assignmentId, formConfig, options = {}) {
  const id = Number(assignmentId || 0) || 0;
  const assignment = getAssignmentById(id);
  const articlePayload = options?.articlePayload && typeof options.articlePayload === "object"
    ? options.articlePayload
    : buildAssignmentSubmissionArticlePayload();
  const uploadQueue = Array.isArray(options?.uploadQueue)
    ? options.uploadQueue
    : buildAssignmentCaptureFileUploadQueue(id, formConfig.captureItems);
  const hasLocalQueue = uploadQueue.length > 0;
  const localSynced = hasLocalQueue ? isAssignmentCaptureUploadsSynced(id, formConfig.captureItems) : true;
  const composed = composeAssignmentSubmissionEffectiveAssets(id, formConfig.captureItems, {
    uploadQueue,
    strict: false,
  });
  const effectiveAssets = Array.isArray(composed?.assets) ? composed.assets : [];
  const serverSynced = composed?.serverSynced || getAssignmentServerSyncedAssetsForCaptureItems(id, formConfig.captureItems);
  const missingTextPrompts = getAssignmentSubmissionMissingTextPrompts(formConfig, articlePayload);
  const missingMedia = Array.isArray(composed?.missing) ? composed.missing : [];
  const expiredBlocking = Number(serverSynced?.expired_count || 0) > 0 && Number(serverSynced?.assets?.length || 0) === 0;
  const hasEffectiveMedia = effectiveAssets.length > 0;
  const blockingReasons = [];
  if (missingTextPrompts.length) {
    blockingReasons.push(
      missingTextPrompts.length === 1 && missingTextPrompts[0] === "ข้อความเพิ่มเติม"
        ? "กรุณากรอกข้อความเพิ่มเติม"
        : "กรุณากรอกข้อมูลที่จำเป็นให้ครบ"
    );
  }
  if (composed?.blockedMessage) {
    blockingReasons.push(String(composed.blockedMessage));
  }
  if (!localSynced) {
    blockingReasons.push("มีไฟล์ที่เลือกใหม่ แต่ยังไม่ได้ซิงก์");
  }
  if (expiredBlocking) {
    blockingReasons.push("ไฟล์ที่ซิงก์ไว้หมดอายุแล้ว กรุณาอัปโหลด/ซิงก์ไฟล์ใหม่อีกครั้ง");
  }
  if (missingMedia.length) {
    blockingReasons.push(`ยังขาดไฟล์สำหรับ: ${missingMedia.join(" | ")}`);
  } else if (!hasEffectiveMedia) {
    blockingReasons.push("กรุณาอัปโหลด/ซิงก์ไฟล์ให้ครบก่อนส่งงานกลับ");
  }
  const warnings = [];
  if (Number(serverSynced?.expired_count || 0) > 0 && Number(serverSynced?.assets?.length || 0) > 0) {
    warnings.push("มีไฟล์เก่าที่หมดอายุแล้วบางส่วน ระบบจะใช้เฉพาะไฟล์ที่ยังพร้อมส่ง");
  }
  const checklist = [
    {
      key: "required_text",
      label: "ข้อมูลที่จำเป็นครบ",
      status: missingTextPrompts.length === 0,
      detail: missingTextPrompts.length
        ? `ยังขาด: ${missingTextPrompts.join(" | ")}`
        : "พร้อมใช้งาน",
    },
    {
      key: "required_media",
      label: "ไฟล์/ช็อตที่จำเป็นครบ",
      status: missingMedia.length === 0 && hasEffectiveMedia,
      detail: missingMedia.length ? `ยังขาดไฟล์สำหรับ: ${missingMedia.join(" | ")}` : (hasEffectiveMedia ? `พร้อม ${effectiveAssets.length} ไฟล์` : "กรุณาอัปโหลด/ซิงก์ไฟล์ให้ครบก่อนส่งงานกลับ"),
    },
    {
      key: "sync_current",
      label: "ไฟล์ซิงก์เป็นชุดล่าสุด",
      status: !composed?.blockedMessage,
      detail: composed?.blockedMessage || "พร้อมใช้งาน",
    },
    {
      key: "not_expired",
      label: "ไฟล์ซิงก์ยังไม่หมดอายุ",
      status: !expiredBlocking,
      detail: expiredBlocking ? "ไฟล์ที่ซิงก์ไว้หมดอายุแล้ว กรุณาอัปโหลด/ซิงก์ไฟล์ใหม่อีกครั้ง" : "พร้อมใช้งาน",
    },
    {
      key: "no_pending_local",
      label: "ไม่มีไฟล์ใหม่ค้างรอซิงก์",
      status: !hasLocalQueue || localSynced,
      detail: !hasLocalQueue || localSynced ? "พร้อมใช้งาน" : "มีไฟล์ที่เลือกใหม่ แต่ยังไม่ได้ซิงก์",
    },
  ];
  return {
    canSubmit: blockingReasons.length === 0,
    blockingReasons: Array.from(new Set(blockingReasons)),
    warnings,
    checklist,
    effectiveAssets,
    missingTextPrompts,
    missingMedia,
    articlePayload,
    uploadQueue,
    composed,
    serverSynced,
  };
}

function renderAssignmentSubmissionGatePanel(gateState) {
  const node = qs("assignment-submit-callout");
  if (!node) return;
  const state = gateState && typeof gateState === "object" ? gateState : null;
  if (!state) {
    node.textContent = "";
    return;
  }
  node.className = "assignment-brief-card";
  node.innerHTML = `
    <div class="assignment-brief-text"><strong>${escapeHtml(state.canSubmit ? "พร้อมส่งงานกลับ" : "ยังส่งงานไม่ได้")}</strong></div>
    <ul class="assignment-brief-list" style="margin-top:8px;">
      ${state.checklist.map((item) => `<li>${item.status ? "ผ่าน" : "ค้าง"} | ${escapeHtml(item.label)} | ${escapeHtml(item.detail)}</li>`).join("")}
    </ul>
    ${state.blockingReasons.length ? `<div class="assignment-brief-text" style="margin-top:8px;"><strong>${escapeHtml(state.blockingReasons[0])}</strong></div>` : ""}
    ${state.warnings.length ? `<div class="assignment-brief-text" style="margin-top:8px;">${escapeHtml(state.warnings.join(" | "))}</div>` : ""}
  `;
}

function focusFirstAssignmentSubmissionGateIssue(gateState) {
  if (!gateState || gateState.canSubmit) return;
  if (gateState.missingTextPrompts?.length) {
    qs("assignment-submission-verified-fields")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector("[data-assignment-prompt-answer]")?.focus();
    return;
  }
  if (gateState.missingMedia?.length || gateState.blockingReasons.some((reason) => /ซิงก์|ไฟล์/.test(String(reason)))) {
    qs("assignment-submission-capture-guide")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  qs("assignment-submit-callout")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildAssignmentSubmissionArticlePayload() {
  const assignment = getAssignmentById(state.assignments.selectedId);
  const formConfig = getAssignmentSubmissionFormConfig(assignment, state.assignments.contextFieldPack);
  if (formConfig.kind === "editorial") {
    return {
      direction_answers: readAssignmentSubmissionPromptAnswers(formConfig.verifiedGroupName),
      source_answers: readAssignmentSubmissionPromptAnswers(formConfig.questionGroupName),
      additional_text: String(qs("assignment-submission-additional-text")?.value || "").trim(),
    };
  }
  return {
    verified_answers: readAssignmentSubmissionPromptAnswers(formConfig.verifiedGroupName),
    capture_answers: readAssignmentSubmissionPromptAnswers(formConfig.captureGroupName || "capture_answers"),
    question_answers: readAssignmentSubmissionPromptAnswers(formConfig.questionGroupName),
    additional_text: String(qs("assignment-submission-additional-text")?.value || "").trim(),
  };
}

function syncAssignmentSubmissionDraftFromForm(assignmentId = state.assignments.selectedId) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return null;
  const assignment = getAssignmentById(id);
  const payload = buildAssignmentSubmissionArticlePayload();
  writeAssignmentSubmissionDraft(id, payload, assignment, { includeArticle: true, includeRequestedChecks: false });
  return payload;
}

async function ensureAssignmentSubmissionPrefillLoaded(assignment = null) {
  if (isEditorUser()) return null;
  const assignmentId = Number(assignment?.id || 0) || 0;
  if (!assignmentId) return null;
  await loadAssignmentSubmissionServerDraft(assignment);
  if (state.assignments.latestSubmissionLoaded?.[assignmentId]) {
    return state.assignments.latestSubmissionArticlePayloads?.[assignmentId] || null;
  }
  state.assignments.latestSubmissionLoaded[assignmentId] = "loading";
  try {
    const result = await api(`/api/assignments/${assignmentId}/submissions`);
    const submissions = Array.isArray(result?.submissions) ? result.submissions : [];
    const latestSubmissionId = Number(assignment?.latest_submission_id || 0) || 0;
    const latestSubmission = latestSubmissionId > 0
      ? submissions.find((row) => Number(row?.id || 0) === latestSubmissionId) || submissions[0] || null
      : submissions[0] || null;
    state.assignments.latestSubmissionRows[assignmentId] = latestSubmission || null;
    state.assignments.latestSubmissionArticlePayloads[assignmentId] = latestSubmission?.article_payload_json || null;
    state.assignments.latestSubmissionLoaded[assignmentId] = true;
    const selectedId = Number(state.assignments.selectedId || 0) || 0;
    const selectedAssignment = getAssignmentById(assignmentId);
    const selectedDraftKey = getAssignmentSubmissionDraftKey(assignmentId, selectedAssignment);
    const serverDraftPayload = state.assignments.serverSubmissionDraftPayloads?.[selectedDraftKey]?.field_return_payload_json || null;
    const latestFieldReturnPayload = latestSubmission?.field_return_payload_json || null;
    if (
      selectedId === assignmentId
      && state.assignments.requestedCheckReturnDraftDirty?.[assignmentId] !== true
      && !hasUsableAssignmentRequestedCheckReturnRows(serverDraftPayload)
      && hasUsableAssignmentRequestedCheckReturnRows(latestFieldReturnPayload)
    ) {
      const handoffPackage = state.assignments.handoffSourcePackages?.[assignmentId] || null;
      const normalizedDraft = normalizeAssignmentRequestedCheckReturnDraft(latestFieldReturnPayload, handoffPackage);
      setAssignmentRequestedCheckReturnDraftState(assignmentId, normalizedDraft, { source: "latest_submission", dirty: false });
      renderAssignmentRequestedCheckSection(getAssignmentSubmissionFormAssignment(selectedAssignment, getAssignmentPageMode()), handoffPackage, normalizedDraft);
    }
    if (
      selectedId === assignmentId
      && !state.assignments.serverSubmissionDraftPayloads?.[selectedDraftKey]
      && !readAssignmentSubmissionDraft(assignmentId, assignment, state.assignments.contextFieldPack)
    ) {
      renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(getAssignmentById(assignmentId)));
    }
    if (selectedId === assignmentId) {
      renderAssignmentReviewSummary(getAssignmentById(assignmentId));
      renderAssignmentReviewSubmissionContent(getAssignmentById(assignmentId));
    }
    return state.assignments.latestSubmissionArticlePayloads[assignmentId];
  } catch (err) {
    state.assignments.latestSubmissionLoaded[assignmentId] = false;
    throw err;
  }
}

function renderAssignmentCreateSummary() {
  const node = qs("assignment-create-summary");
  if (!node) return;
  const itemId = Number(state.assignments.contextItemId || getAssignmentLandingItemId() || 0) || 0;
  const item = (state.items || []).find((row) => Number(row?.id || 0) === itemId) || null;
  const assignmentKind = getAssignmentCreateKind();
  const assignmentKindLabel = assignmentKind === "editorial" ? "editorial" : "field";
  if (!itemId || !item) {
    node.className = "assignment-brief-empty";
    node.innerHTML = "ยังไม่ได้เลือกรายการที่จะส่งงานไปทำ";
    return;
  }
  const hasCurrentFieldPack = Boolean(state.assignments.contextFieldPack);
  const prepState = getAssignmentPrepStepState(state.assignments.contextFieldPackStatus, state.assignments.contextFieldPack);
  const fieldPackStatus = state.assignments.contextFieldPackLoadFailed
    ? "โหลดไม่สำเร็จ"
    : hasCurrentFieldPack
      ? formatAssignmentContextFieldPackStatusLabel(state.assignments.contextFieldPackStatus)
      : "ยังไม่มีชุดลงหน้างานปัจจุบัน";
  const briefStepLabel = prepState.briefPrepared ? "ผ่านแล้ว" : "ยังไม่ผ่าน";
  const readyStepLabel = prepState.readyForAssignment ? "ผ่านแล้ว" : "ยังไม่ผ่าน";
  node.className = "assignment-brief-section";
  node.innerHTML = `
    <div class="assignment-brief-text"><strong>item #${escapeHtml(String(itemId))}</strong> · ${escapeHtml(String(item.title || "").trim() || "-")}</div>
    <div class="assignment-brief-text">หมวด ${escapeHtml(toCategoryLabel(item.category))} · ภาษา ${escapeHtml(String(item.lang || "").trim() || "-")} · ประเภทงาน ${escapeHtml(assignmentKindLabel)}</div>
    <div class="assignment-brief-text">สถานะชุดลงหน้างาน: ${escapeHtml(fieldPackStatus)}</div>
    <div class="assignment-brief-text">จัด brief: ${escapeHtml(briefStepLabel)} · พร้อมส่งเข้า handoff: ${escapeHtml(readyStepLabel)}</div>
  `;
}

function getFieldPackPromptGroups(fieldPack = null) {
  const checklists = Array.isArray(fieldPack?.checklists) ? fieldPack.checklists : [];
  return {
    mustVerify: checklists
      .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === "must_verify_fact")
      .map((row) => String(row?.item_text || "").trim())
      .filter(Boolean),
    mustCapture: checklists
      .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === "must_capture")
      .map((row, index) => ({
        item_text: String(row?.item_text || "").trim(),
        capture_type: String(row?.capture_type || "").trim().toLowerCase() || "",
        item_order: Number.isFinite(Number(row?.item_order)) ? Number(row.item_order) : index,
      }))
      .filter((row) => Boolean(row.item_text)),
    mustAsk: checklists
      .filter((row) => String(row?.checklist_type || "").trim().toLowerCase() === "must_ask_question")
      .map((row) => String(row?.item_text || "").trim())
      .filter(Boolean),
  };
}

function getEditorialPromptGroups(fieldPack = null, brief = null) {
  const summary = String(fieldPack?.editor_summary || fieldPack?.ai_summary || brief?.brief_summary || "").trim();
  const socialHook = String(fieldPack?.social_hook || brief?.recommended_hook || "").trim();
  const socialCaptionAngle = String(
    fieldPack?.social_caption_angle
    || (Array.isArray(brief?.caption_suggestions) ? brief.caption_suggestions[0] : "")
    || ""
  ).trim();
  const socialShotEmphasis = Array.isArray(fieldPack?.social_shot_emphasis_json)
    ? fieldPack.social_shot_emphasis_json.map((value) => String(value || "").trim()).filter(Boolean)
    : uniqueAssignmentBriefStrings(brief?.shot_list_suggestions);
  const socialOnCameraPoints = Array.isArray(fieldPack?.social_on_camera_points_json)
    ? fieldPack.social_on_camera_points_json.map((value) => String(value || "").trim()).filter(Boolean)
    : uniqueAssignmentBriefStrings(brief?.script_suggestions);
  const fallbackGroups = getAssignmentBriefPromptGroups(brief);
  const { mustVerify, mustCapture, mustAsk } = fieldPack ? getFieldPackPromptGroups(fieldPack) : fallbackGroups;
  const directionPrompts = [
    summary ? `สรุปแกนเรื่องจากต้นทาง: ${summary}` : "",
    socialHook ? `Hook ที่ควรรักษา: ${socialHook}` : "",
    socialCaptionAngle ? `แนว Caption/Copy ที่ควรรักษา: ${socialCaptionAngle}` : "",
    ...socialOnCameraPoints.map((value) => `ประเด็นที่ต้องเล่า: ${value}`),
  ];
  const sourcePrompts = [
    ...mustVerify,
    ...mustAsk,
  ];
  const captureItems = [
    ...mustCapture,
    ...socialShotEmphasis.map((value) => `ช็อตหรือไฟล์อ้างอิงที่ควรมี: ${value}`),
  ];
  const unique = (items) => Array.from(new Set((Array.isArray(items) ? items : []).map((value) => String(value || "").trim()).filter(Boolean)));
  return {
    directionPrompts: unique(directionPrompts).length ? unique(directionPrompts) : ["สรุปมุมเล่าและโทนของงานเรียบเรียงที่ต้องรักษา"],
    sourcePrompts: unique(sourcePrompts).length ? unique(sourcePrompts) : ["ระบุข้อมูลหรือข้อเท็จจริงที่ต้องอ้างอิงให้ครบก่อนเรียบเรียง"],
    captureItems,
  };
}

function getAssignmentSubmissionFormConfig(assignment = null, fieldPack = null) {
  const kind = getAssignmentSubmissionKind(assignment);
  const brief = assignment?.brief_json && typeof assignment.brief_json === "object"
    ? assignment.brief_json
    : null;
  if (kind === "editorial") {
    const groups = getEditorialPromptGroups(fieldPack, brief);
    return {
      kind,
      workspaceHelp: "ขั้นที่ 1: อัปโหลด/ซิงก์ไฟล์อ้างอิง | ขั้นที่ 2: ส่งงานกลับ พร้อมสรุปมุมเล่า งานเขียน หรือโน้ตที่ต้องใช้ต่อยอด",
      briefLabel: "สรุปงานอ้างอิง (มุมมองพิมพ์)",
      verifiedLabel: "แนวสื่อสารหลัก",
      questionLabel: "ข้อมูล/มุมที่ต้องใช้",
      captureLabel: "ช็อต/ไฟล์อ้างอิงที่ควรมี",
      additionalLabel: "โน้ตเพิ่มเติมสำหรับงานเรียบเรียง",
      filesLabel: "สรุปไฟล์ที่จะส่ง",
      emptyVerified: "เลือกงานก่อนเพื่อกรอกแนวสื่อสารสำหรับงานเรียบเรียง",
      emptyQuestion: "เลือกงานก่อนเพื่อกรอกข้อมูลอ้างอิงสำหรับงานเรียบเรียง",
      emptyCapture: "เลือกงานก่อนเพื่อดูช็อตหรือไฟล์ที่ควรใช้",
      additionalPlaceholder: "สรุป draft, caption, script หรือ note ที่ต้องการส่งต่อ",
      answerPlaceholder: "กรอกข้อมูลสำหรับงานเรียบเรียง",
      verifiedGroupName: "direction_answers",
      questionGroupName: "source_answers",
      verifiedAnswers: "direction_answers",
      questionAnswers: "source_answers",
      verifiedPrompts: groups.directionPrompts,
      questionPrompts: groups.sourcePrompts,
      captureItems: groups.captureItems,
    };
  }
  const groups = fieldPack ? getFieldPackPromptGroups(fieldPack) : getAssignmentBriefPromptGroups(brief);
  return {
    kind,
    workspaceHelp: "ขั้นที่ 1: อัปโหลด/ซิงก์รูปหรือวิดีโอ | ขั้นที่ 2: ส่งงานกลับ พร้อมกรอกข้อมูลที่ได้จากหน้างาน",
    briefLabel: "ใบสั่งงาน (มุมมองพิมพ์)",
    verifiedLabel: "สิ่งที่ต้องยืนยัน",
    questionLabel: "คำตอบจากหน้างาน",
    captureLabel: "สิ่งที่ต้องถ่าย",
    additionalLabel: "ข้อความเพิ่มเติม",
    filesLabel: "สรุปไฟล์ที่จะส่ง",
    emptyVerified: "เลือกงานก่อนเพื่อกรอกคำตอบจากหน้างาน",
    emptyQuestion: "เลือกงานก่อนเพื่อกรอกคำตอบจากหน้างาน",
    emptyCapture: "เลือกงานก่อนเพื่อดูรายการที่ต้องถ่าย",
    additionalPlaceholder: "สรุปข้อมูลเพิ่มเติมจากหน้างานหรือหมายเหตุประกอบไฟล์",
    answerPlaceholder: "กรอกข้อมูลที่ได้จากหน้างาน",
    verifiedGroupName: "verified_answers",
    captureGroupName: "capture_answers",
    questionGroupName: "question_answers",
    verifiedAnswers: "verified_answers",
    captureAnswers: "capture_answers",
    questionAnswers: "question_answers",
    verifiedPrompts: groups.mustVerify,
    questionPrompts: groups.mustAsk,
    captureItems: groups.mustCapture,
  };
}

function normalizeAssignmentRequestedCheckKeyPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildAssignmentRequestedCheckReturnKey(groupKey, checkKey) {
  const group = normalizeAssignmentRequestedCheckKeyPart(groupKey);
  const key = normalizeAssignmentRequestedCheckKeyPart(checkKey);
  return group && key ? `${group}.${key}` : "";
}

function formatRequestedCheckSuggestedValue(value, answerType = "text") {
  if (value == null) return "";
  if (answerType === "multi_select" && Array.isArray(value)) return value.join("\n");
  if ((answerType === "boolean" || answerType === "boolean_with_conditions") && typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (answerType === "number_with_unit" && value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value || "");
}

function hasAssignmentRequestedCheckMeaningfulSuggestedValue(value, answerType = "text") {
  return hasAssignmentRequestedCheckMeaningfulValue(value, answerType);
}

function hasAssignmentRequestedCheckMeaningfulValue(value, answerType = "text") {
  const normalized = String(answerType || "text").trim().toLowerCase() || "text";
  if (value == null) return false;
  if (normalized === "multi_select") return Array.isArray(value) && value.some((entry) => String(entry || "").trim());
  if (normalized === "number_with_unit") {
    return Boolean(String(value?.number ?? "").trim() || String(value?.unit ?? "").trim());
  }
  if (normalized === "boolean" || normalized === "boolean_with_conditions") {
    return typeof value === "boolean";
  }
  if (normalized === "note_only") return false;
  return String(formatRequestedCheckSuggestedValue(value, normalized) || "").trim().length > 0;
}

function isAssignmentCurationRenderableCheck(check) {
  const groupKey = String(check?.group_key || "").trim().toLowerCase();
  const checkKey = String(check?.check_key || check?.key || "").trim().toLowerCase();
  if (groupKey !== "taxonomy") return false;
  if (!checkKey) return false;
  if (checkKey === "category" || checkKey === "subtype" || checkKey === "tags") return false;
  return true;
}

function resolveAssignmentCurationCheckPlacement(check, row, options = {}) {
  if (!isAssignmentCurationRenderableCheck(check)) return "hidden";
  const checkKey = String(check?.check_key || check?.key || "").trim().toLowerCase();
  const applicableKeys = options?.applicableKeys instanceof Set ? options.applicableKeys : null;
  if (hasAssignmentRequestedCheckMeaningfulValue(check?.suggested_value, check?.answer_type)) return "primary";
  if (applicableKeys?.has(checkKey)) return "primary";
  return "additional";
}

function getAssignmentRequestedCheckGroupsFromHandoffPackage(handoffPackage = null) {
  const requestedChecks = handoffPackage && typeof handoffPackage === "object" && !Array.isArray(handoffPackage)
    ? handoffPackage.requested_checks
    : null;
  const groups = Array.isArray(requestedChecks?.groups) ? requestedChecks.groups : [];
  return groups
    .map((group) => {
      const groupKey = normalizeAssignmentRequestedCheckKeyPart(group?.group_key);
      const groupLabel = String(group?.group_label || "").trim() || groupKey;
      if (!groupKey) return null;
      const checks = Array.isArray(group?.checks) ? group.checks : [];
      const normalizedChecksForGroup = checks
        .map((check) => {
          const checkKey = normalizeAssignmentRequestedCheckKeyPart(check?.key);
          const returnKey = buildAssignmentRequestedCheckReturnKey(groupKey, checkKey);
          if (!returnKey) return null;
          return {
            group_key: groupKey,
            group_label: groupLabel,
            check_key: checkKey,
            return_key: returnKey,
            requested: check?.requested === true,
            label: String(check?.label || "").trim(),
            instruction: String(check?.instruction || "").trim(),
            answer_type: String(check?.answer_type || "text").trim().toLowerCase() || "text",
            allowed_values: Array.isArray(check?.allowed_values) ? check.allowed_values.map((value) => String(value || "").trim()).filter(Boolean) : null,
            unit_options: Array.isArray(check?.unit_options) ? check.unit_options.map((value) => String(value || "").trim()).filter(Boolean) : null,
            activation_mode: check?.activation_mode == null ? null : String(check.activation_mode || "").trim().toLowerCase() || null,
            required: check?.required === true,
            suggested_value: Object.prototype.hasOwnProperty.call(check || {}, "suggested_value")
              ? check.suggested_value
              : null,
            evidence_required: check?.evidence_required === true,
            condition_prompt: check?.condition_prompt == null ? null : String(check.condition_prompt || "").trim() || null,
            source: check?.source || null,
          };
        })
        .filter(Boolean);
      if (!normalizedChecksForGroup.length) return null;
      return {
        group_key: groupKey,
        group_label: groupLabel,
        checks: normalizedChecksForGroup,
      };
    })
    .filter(Boolean);
}

function getAssignmentRequestedCheckDefaultValue(answerType = "text") {
  const normalized = String(answerType || "").trim().toLowerCase();
  if (normalized === "multi_select") return [];
  if (normalized === "number_with_unit") return { number: "", unit: "" };
  if (normalized === "boolean" || normalized === "boolean_with_conditions" || normalized === "note_only") return null;
  return "";
}

function cloneAssignmentRequestedCheckValue(value, answerType = "text") {
  const normalized = String(answerType || "").trim().toLowerCase();
  if (normalized === "multi_select") {
    return Array.isArray(value) ? value.map((entry) => String(entry || "").trim()).filter(Boolean) : [];
  }
  if (normalized === "number_with_unit") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { number: "", unit: "" };
    return {
      number: value.number == null ? "" : value.number,
      unit: String(value.unit ?? "").trim(),
    };
  }
  if (normalized === "boolean" || normalized === "boolean_with_conditions") {
    return typeof value === "boolean" ? value : null;
  }
  if (normalized === "note_only") return null;
  return value == null ? "" : String(value || "");
}

function areAssignmentRequestedCheckValuesEqual(leftValue, rightValue, answerType = "text") {
  const normalized = String(answerType || "text").trim().toLowerCase() || "text";
  const left = cloneAssignmentRequestedCheckValue(leftValue, normalized);
  const right = cloneAssignmentRequestedCheckValue(rightValue, normalized);
  if (normalized === "multi_select") {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  if (normalized === "number_with_unit") {
    return String(left?.number ?? "") === String(right?.number ?? "")
      && String(left?.unit ?? "") === String(right?.unit ?? "");
  }
  return left === right;
}

function buildAssignmentRequestedCheckReturnDraftFromHandoffPackage(handoffPackage = null) {
  const groups = getAssignmentRequestedCheckGroupsFromHandoffPackage(handoffPackage);
  const requestedCheckReturns = {};
  groups.forEach((group) => {
    (Array.isArray(group.checks) ? group.checks : []).forEach((check) => {
      const hasSuggestedValue = check.suggested_value != null;
      requestedCheckReturns[check.return_key] = {
        group_key: group.group_key,
        group_label: group.group_label,
        check_key: check.check_key,
        return_key: check.return_key,
        answer_type: check.answer_type,
        allowed_values: Array.isArray(check.allowed_values) ? cloneAssignmentRequestedCheckValue(check.allowed_values, "multi_select") : null,
        unit_options: Array.isArray(check.unit_options) ? cloneAssignmentRequestedCheckValue(check.unit_options, "multi_select") : null,
        activation_mode: check.activation_mode == null ? null : String(check.activation_mode || "").trim().toLowerCase() || null,
        required: check.required === true,
        checked: false,
        value: isAssignmentRequestedCheckTaxonomyBooleanRow({
          group_key: group.group_key,
          answer_type: check.answer_type,
        })
          ? false
          : (
            hasSuggestedValue
              ? cloneAssignmentRequestedCheckValue(check.suggested_value, check.answer_type)
              : getAssignmentRequestedCheckDefaultValue(check.answer_type)
          ),
        condition_note: "",
        evidence: "",
        note: "",
        label: check.label,
        instruction: check.instruction,
        suggested_value: check.suggested_value,
        evidence_required: check.evidence_required,
        condition_prompt: check.condition_prompt,
        source: check.source,
      };
    });
  });
  return { requested_check_returns: requestedCheckReturns };
}

function normalizeAssignmentRequestedCheckReturnDraft(draft = null, handoffPackage = null) {
  const base = buildAssignmentRequestedCheckReturnDraftFromHandoffPackage(handoffPackage);
  const incoming = draft && typeof draft === "object" && !Array.isArray(draft) ? draft : {};
  const incomingReturns = incoming.requested_check_returns && typeof incoming.requested_check_returns === "object" && !Array.isArray(incoming.requested_check_returns)
    ? incoming.requested_check_returns
    : {};
  const requestedCheckReturns = {};
  const keys = new Set([...Object.keys(base.requested_check_returns || {}), ...Object.keys(incomingReturns || {})]);
  keys.forEach((returnKey) => {
    const baseRow = base.requested_check_returns?.[returnKey] || {};
    const incomingRow = incomingReturns?.[returnKey] && typeof incomingReturns[returnKey] === "object" && !Array.isArray(incomingReturns[returnKey])
      ? incomingReturns[returnKey]
      : {};
    requestedCheckReturns[returnKey] = {
      ...baseRow,
      ...incomingRow,
      checked: incomingRow.checked === true,
      condition_note: String(incomingRow.condition_note == null ? baseRow.condition_note || "" : incomingRow.condition_note || "").trim(),
      evidence: String(incomingRow.evidence == null ? baseRow.evidence || "" : incomingRow.evidence || "").trim(),
      note: String(incomingRow.note == null ? baseRow.note || "" : incomingRow.note || "").trim(),
      value: Object.prototype.hasOwnProperty.call(incomingRow, "value")
        ? incomingRow.value
        : baseRow.value,
      answer_type: String(baseRow.answer_type || incomingRow.answer_type || "text").trim().toLowerCase() || "text",
      allowed_values: Array.isArray(baseRow.allowed_values) ? cloneAssignmentRequestedCheckValue(baseRow.allowed_values, "multi_select") : null,
      unit_options: Array.isArray(baseRow.unit_options) ? cloneAssignmentRequestedCheckValue(baseRow.unit_options, "multi_select") : null,
      activation_mode: baseRow.activation_mode == null ? null : String(baseRow.activation_mode || "").trim().toLowerCase() || null,
      required: baseRow.required === true,
      evidence_required: baseRow.evidence_required === true,
      condition_prompt: baseRow.condition_prompt == null ? null : String(baseRow.condition_prompt || "").trim() || null,
      suggested_value: Object.prototype.hasOwnProperty.call(baseRow, "suggested_value") ? baseRow.suggested_value : null,
      source: baseRow.source || null,
    };
  });
  return { requested_check_returns: requestedCheckReturns };
}

function getAssignmentRequestedCheckReturnDraftPrefill(assignment = null, handoffPackage = null) {
  const assignmentId = Number(assignment?.id || state.assignments.selectedId || 0) || 0;
  if (!assignmentId) return null;
  const existingDraft = state.assignments.requestedCheckReturnDrafts?.[assignmentId] || null;
  const existingSource = state.assignments.requestedCheckReturnDraftSources?.[assignmentId] || null;
  const existingDirty = state.assignments.requestedCheckReturnDraftDirty?.[assignmentId] === true;
  if (existingDirty && hasUsableAssignmentRequestedCheckReturnRows(existingDraft)) {
    return normalizeAssignmentRequestedCheckReturnDraft(existingDraft, handoffPackage);
  }
  const draftKey = getAssignmentSubmissionDraftKey(assignmentId, assignment);
  const serverDraftPayload = state.assignments.serverSubmissionDraftPayloads?.[draftKey]?.field_return_payload_json || null;
  const serverDraftReturns = serverDraftPayload?.requested_check_returns;
  if (hasUsableAssignmentRequestedCheckReturnRows(serverDraftPayload)) {
    return normalizeAssignmentRequestedCheckReturnDraft({ requested_check_returns: serverDraftReturns }, handoffPackage);
  }
  const latestSubmission = getLatestAssignmentSubmissionRow(assignment);
  const latestPayload = latestSubmission?.field_return_payload_json || null;
  const latestReturns = latestPayload?.requested_check_returns;
  if (hasUsableAssignmentRequestedCheckReturnRows(latestPayload)) {
    return normalizeAssignmentRequestedCheckReturnDraft({ requested_check_returns: latestReturns }, handoffPackage);
  }
  if (hasUsableAssignmentRequestedCheckReturnRows(existingDraft) && existingSource) {
    return normalizeAssignmentRequestedCheckReturnDraft(existingDraft, handoffPackage);
  }
  return normalizeAssignmentRequestedCheckReturnDraft(null, handoffPackage);
}

function isAssignmentRequestedCheckTaxonomyBooleanRow(row = {}) {
  const groupKey = String(row?.group_key || "").trim().toLowerCase();
  const answerType = String(row?.answer_type || "").trim().toLowerCase();
  return groupKey === "taxonomy" && (answerType === "boolean" || answerType === "boolean_with_conditions");
}

function buildAssignmentRequestedCheckReturnSubmissionRow(row = {}) {
  const checked = row?.checked === true;
  if (checked) {
    return {
      checked: true,
      value: row.value == null ? null : row.value,
      condition_note: String(row.condition_note || "").trim() || null,
      evidence: String(row.evidence || "").trim() || null,
      note: String(row.note || "").trim() || null,
    };
  }
  if (isAssignmentRequestedCheckTaxonomyBooleanRow(row)) {
    return {
      checked: true,
      value: false,
      condition_note: String(row.condition_note || "").trim() || null,
      evidence: null,
      note: String(row.note || "").trim() || null,
    };
  }
  return {
    checked: true,
    value: null,
    condition_note: String(row.condition_note || "").trim() || null,
    evidence: null,
    note: String(row.note || "").trim() || null,
  };
}

function buildAssignmentRequestedCheckReturnPayloadFromDraft(draft = null) {
  const normalized = normalizeAssignmentRequestedCheckReturnDraft(draft, null);
  const requested_check_returns = {};
  Object.entries(normalized.requested_check_returns || {}).forEach(([returnKey, row]) => {
    requested_check_returns[returnKey] = buildAssignmentRequestedCheckReturnSubmissionRow(row);
  });
  return Object.keys(requested_check_returns).length ? { requested_check_returns } : null;
}

function buildAssignmentRequestedCheckReturnValueInputHtml(row) {
  const answerType = String(row?.answer_type || "text").trim().toLowerCase() || "text";
  const groupKey = String(row?.group_key || "").trim().toLowerCase();
  const checked = row?.checked === true;
  const disabledAttr = checked ? "" : "disabled";
  const allowedValues = Array.isArray(row?.allowed_values) ? row.allowed_values.map((value) => String(value || "").trim()).filter(Boolean) : [];
  const unitOptions = Array.isArray(row?.unit_options) ? row.unit_options.map((value) => String(value || "").trim()).filter(Boolean) : [];
  if (groupKey === "taxonomy" && (answerType === "boolean" || answerType === "boolean_with_conditions")) return "";
  if (answerType === "boolean" || answerType === "boolean_with_conditions") {
    const currentValue = row?.value === true ? "true" : (row?.value === false ? "false" : "");
    return `
      <select data-requested-check-field="value" ${disabledAttr}>
        <option value="" ${currentValue === "" ? "selected" : ""}>-- ยังไม่ระบุ --</option>
        <option value="true" ${currentValue === "true" ? "selected" : ""}>ใช่</option>
        <option value="false" ${currentValue === "false" ? "selected" : ""}>ไม่ใช่</option>
      </select>
    `;
  }
  if (answerType === "select" && allowedValues.length) {
    const currentValue = row?.value == null ? "" : String(row.value || "").trim();
    return `
      <select data-requested-check-field="value" ${disabledAttr}>
        <option value="" ${currentValue === "" ? "selected" : ""}>-- ยังไม่ระบุ --</option>
        ${allowedValues.map((value) => `<option value="${escapeHtml(value)}" ${currentValue === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
      </select>
    `;
  }
  if (answerType === "multi_select") {
    const listValue = Array.isArray(row?.value) ? row.value : [];
    if (allowedValues.length) {
      return `
        <div class="requested-check-multi-select-list">
          ${allowedValues.map((value) => {
            const selected = listValue.includes(value);
            return `
              <label class="assignment-inline-check">
                <input data-requested-check-field="value-multi" type="checkbox" value="${escapeHtml(value)}" ${selected ? "checked" : ""} ${disabledAttr} />
                <span>${escapeHtml(value)}</span>
              </label>
            `;
          }).join("")}
        </div>
      `;
    }
    return `<textarea data-requested-check-field="value" rows="1" placeholder="ใส่ทีละบรรทัด"${disabledAttr}>${escapeHtml(listValue.map((value) => String(value || "").trim()).filter(Boolean).join("\n"))}</textarea>`;
  }
  if (answerType === "number_with_unit") {
    const numberValue = row?.value && typeof row.value === "object" && !Array.isArray(row.value)
      ? String(row.value.number ?? "").trim()
      : "";
    const unitValue = row?.value && typeof row.value === "object" && !Array.isArray(row.value)
      ? String(row.value.unit ?? "").trim()
      : "";
    const unitControl = unitOptions.length
      ? `
        <select data-requested-check-field="value-unit" ${disabledAttr}>
          <option value="" ${unitValue === "" ? "selected" : ""}>-- ยังไม่ระบุ --</option>
          ${unitOptions.map((value) => `<option value="${escapeHtml(value)}" ${unitValue === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}
        </select>
      `
      : `<input data-requested-check-field="value-unit" type="text" value="${escapeHtml(unitValue)}" placeholder="เช่น คน, คัน, กิโลกรัม" ${disabledAttr} />`;
    return `
      <div class="grid requested-check-row-number-with-unit">
        <div>
          <input data-requested-check-field="value-number" type="number" value="${escapeHtml(numberValue)}" ${disabledAttr} />
        </div>
        <div>
          ${unitControl}
        </div>
      </div>
    `;
  }
  const inputType = answerType === "url"
    ? "url"
    : answerType === "phone"
      ? "tel"
      : "text";
  const value = row?.value == null ? "" : String(row.value || "");
  return `<input data-requested-check-field="value" type="${escapeHtml(inputType)}" value="${escapeHtml(value)}" ${disabledAttr} />`;
}

function buildAssignmentRequestedCheckReturnSecondaryFieldsHtml(row) {
  return `
    <div class="requested-check-row-secondary">
      <label class="requested-check-row-secondary-field">
        <span class="requested-check-row-secondary-label">เงื่อนไข</span>
        <input data-requested-check-field="condition_note" type="text" value="${escapeHtml(String(row.condition_note || ""))}" placeholder="เงื่อนไข" />
      </label>
      <label class="requested-check-row-secondary-field">
        <span class="requested-check-row-secondary-label">หลักฐาน</span>
        <input data-requested-check-field="evidence" type="text" value="${escapeHtml(String(row.evidence || ""))}" placeholder="หลักฐาน" />
      </label>
      <label class="requested-check-row-secondary-field">
        <span class="requested-check-row-secondary-label">หมายเหตุ</span>
        <input data-requested-check-field="note" type="text" value="${escapeHtml(String(row.note || ""))}" placeholder="หมายเหตุ" />
      </label>
    </div>
  `;
}

function buildAssignmentRequestedCheckReturnRowHtml(check, row, options = {}) {
  const isTaxonomyBoolean = isAssignmentRequestedCheckTaxonomyBooleanRow({
    group_key: check?.group_key,
    answer_type: check?.answer_type,
  });
  const checked = isTaxonomyBoolean ? row?.value === true : row.checked === true;
  const usesSuggestedValue = isTaxonomyBoolean
    ? hasAssignmentRequestedCheckMeaningfulSuggestedValue(check.suggested_value, check.answer_type)
    : (
      hasAssignmentRequestedCheckMeaningfulSuggestedValue(check.suggested_value, check.answer_type)
      && areAssignmentRequestedCheckValuesEqual(row.value, check.suggested_value, check.answer_type)
    );
  const showConditionNote = options?.showConditionNote === true;
  const showEvidence = check?.evidence_required === true;
  const rowModifierClass = String(options?.rowModifierClass || "").trim();
  const extraClass = rowModifierClass ? ` ${rowModifierClass}` : "";
  const isCurationRow = rowModifierClass.includes("requested-check-curation-row");
  const aiBadgeHtml = usesSuggestedValue ? `<span class="workflow-badge workflow-badge-generated">AI แนะนำ</span>` : "";
  const conditionValue = String(row?.condition_note || "");
  const evidenceValue = String(row?.evidence || "");
  const secondaryFields = [];
  const curationConditionFieldHtml = showConditionNote && isCurationRow
    ? `<input class="requested-check-row-condition" type="text" data-requested-check-field="condition_note" value="${escapeHtml(conditionValue)}" placeholder="เงื่อนไข/รายละเอียดเพิ่มเติม" ${checked ? "" : "disabled"} />`
    : "";
  if (showConditionNote && !isCurationRow) {
    secondaryFields.push(`
      <label class="requested-check-row-secondary-field">
        <span class="requested-check-row-secondary-label">เงื่อนไข/รายละเอียดเพิ่มเติม</span>
        <input type="text" data-requested-check-field="condition_note" value="${escapeHtml(conditionValue)}" placeholder="เงื่อนไข/รายละเอียดเพิ่มเติม" ${checked ? "" : "disabled"} />
      </label>
    `);
  }
  if (showEvidence) {
    secondaryFields.push(`
      <label class="requested-check-row-secondary-field">
        <span class="requested-check-row-secondary-label">หลักฐาน (จำเป็น)</span>
        <input type="text" data-requested-check-field="evidence" value="${escapeHtml(evidenceValue)}" placeholder="หลักฐาน" ${checked ? "" : "disabled"} />
      </label>
    `);
  }
  return `
    <div class="assignment-brief-section full-span assignment-capture-card requested-check-cta-row${extraClass}" data-requested-check-row data-requested-check-return-key="${escapeHtml(check.return_key)}" data-requested-check-answer-type="${escapeHtml(check.answer_type)}" data-requested-check-group-key="${escapeHtml(check.group_key)}" data-requested-check-key="${escapeHtml(check.check_key)}">
      <div class="assignment-capture-row requested-check-row-main">
        <label class="assignment-inline-check">
          <input data-requested-check-field="checked" type="checkbox" ${checked ? "checked" : ""} />
        </label>
        <div class="assignment-capture-title requested-check-row-label">
          <strong>${escapeHtml(check.label || check.check_key)}</strong>
          ${isCurationRow ? aiBadgeHtml : ""}
        </div>
        ${isCurationRow ? "" : `<div class="assignment-capture-actions requested-check-row-status">${aiBadgeHtml}</div>`}
        ${isTaxonomyBoolean && isCurationRow
          ? ""
          : `<div class="requested-check-row-value">
          ${buildAssignmentRequestedCheckReturnValueInputHtml({ ...row, answer_type: check?.answer_type, group_key: check?.group_key })}
        </div>`}
        ${curationConditionFieldHtml}
      </div>
      ${secondaryFields.length ? `<div class="requested-check-row-secondary">${secondaryFields.join("")}</div>` : ""}
    </div>
  `;
}

function buildAssignmentRequestedCheckReturnSectionHtml(assignment = null, handoffPackage = null, draft = null) {
  const visibleGroupOrder = ["cta_contact", "taxonomy"];
  const getGroupSortWeight = (groupKey = "") => {
    const index = visibleGroupOrder.indexOf(String(groupKey || "").trim().toLowerCase());
    return index >= 0 ? index : visibleGroupOrder.length;
  };
  const groups = getAssignmentRequestedCheckGroupsFromHandoffPackage(handoffPackage)
    .sort((left, right) => getGroupSortWeight(left?.group_key) - getGroupSortWeight(right?.group_key));
  if (!groups.length) return "";
  const normalizedDraft = normalizeAssignmentRequestedCheckReturnDraft(draft, handoffPackage);
  return groups.map((group) => {
    const groupKey = String(group?.group_key || "").trim().toLowerCase();
    const checks = Array.isArray(group.checks) ? group.checks : [];
    if (!checks.length) return "";
    if (groupKey === "taxonomy") {
      const primaryRows = [];
      const additionalRows = [];
      checks.forEach((check) => {
        const row = normalizedDraft.requested_check_returns?.[check.return_key] || {};
        const placement = resolveAssignmentCurationCheckPlacement(check, row);
        if (placement === "hidden") return;
        const rowHtml = buildAssignmentRequestedCheckReturnRowHtml(check, row, {
          showConditionNote: true,
          rowModifierClass: "requested-check-curation-row",
        });
        if (placement === "primary") {
          primaryRows.push(rowHtml);
        } else {
          additionalRows.push({ row, html: rowHtml });
        }
      });
      const shouldOpenAdditional = additionalRows.some(({ row }) => row?.checked === true
        || hasAssignmentRequestedCheckMeaningfulValue(row?.value, row?.answer_type)
        || String(row?.condition_note || "").trim().length > 0);
      if (!primaryRows.length && !additionalRows.length) return "";
      return `
        <div class="assignment-brief-section full-span requested-check-cta-section requested-check-curation-section" data-requested-check-group="${escapeHtml(group.group_key)}">
          <div class="assignment-brief-label">Curation</div>
          ${primaryRows.join("")}
          ${additionalRows.length ? `
            <details class="requested-check-curation-more"${shouldOpenAdditional ? " open" : ""}>
              <summary class="requested-check-curation-more-summary">ตัวเลือกเพิ่มเติม (${additionalRows.length})</summary>
              <div class="requested-check-curation-more-list">
                ${additionalRows.map((entry) => entry.html).join("")}
              </div>
            </details>
          ` : ""}
        </div>
      `;
    }
    if (groupKey === "cta_contact") {
      return `
        <div class="assignment-brief-section full-span requested-check-cta-section" data-requested-check-group="${escapeHtml(group.group_key)}">
          <div class="assignment-brief-label">CTA/ติดต่อ</div>
          ${checks.map((check) => buildAssignmentRequestedCheckReturnRowHtml(check, normalizedDraft.requested_check_returns?.[check.return_key] || {}, {
            showConditionNote: false,
          })).join("")}
        </div>
      `;
    }
    const sectionLabel = String(group?.group_label || groupKey || "Requested checks").trim() || "Requested checks";
    return `
      <div class="assignment-brief-section full-span requested-check-cta-section" data-requested-check-group="${escapeHtml(group.group_key)}">
        <div class="assignment-brief-label">${escapeHtml(sectionLabel)}</div>
        ${checks.map((check) => buildAssignmentRequestedCheckReturnRowHtml(check, normalizedDraft.requested_check_returns?.[check.return_key] || {}, {
          showConditionNote: true,
        })).join("")}
      </div>
    `;
  }).join("");
}

function clearAllAssignmentRequestedCheckValidationErrors() {
  const summaryNode = qs("assignment-submission-requested-checks-error");
  if (summaryNode) {
    summaryNode.textContent = "";
    summaryNode.classList.add("hidden");
  }
  document.querySelectorAll("[data-requested-check-row].requested-check-row-invalid").forEach((rowNode) => {
    rowNode.classList.remove("requested-check-row-invalid");
    const messageNode = rowNode.querySelector(".requested-check-row-validation-message");
    if (messageNode) messageNode.remove();
  });
}

function displayAssignmentRequestedCheckValidationErrors(err) {
  const payload = err?.payload && typeof err.payload === "object" ? err.payload : null;
  const errors = Array.isArray(payload?.validation_errors) ? payload.validation_errors : [];
  if (!errors.length) return;

  const requestedChecksNode = qs("assignment-submission-requested-checks-fields");
  if (!requestedChecksNode) return;

  const labelNode = qs("assignment-submission-requested-checks-label");
  let summaryNode = qs("assignment-submission-requested-checks-error");
  if (!summaryNode) {
    summaryNode = document.createElement("div");
    summaryNode.id = "assignment-submission-requested-checks-error";
    summaryNode.className = "assignment-brief-text";
    summaryNode.style.color = "#b42318";
    summaryNode.style.fontWeight = "bold";
    summaryNode.style.marginBottom = "8px";
    if (labelNode && labelNode.parentNode) {
      labelNode.parentNode.insertBefore(summaryNode, labelNode.nextSibling);
    }
  }
  summaryNode.classList.remove("hidden");
  summaryNode.textContent = String(payload?.message || "").trim() || "กรุณาตรวจสอบข้อมูลที่ต้องยืนยัน";

  const rows = typeof requestedChecksNode.querySelectorAll === "function"
    ? Array.from(requestedChecksNode.querySelectorAll("[data-requested-check-row]"))
    : [];
  for (const rowNode of rows) {
    const returnKey = String(rowNode.getAttribute("data-requested-check-return-key") || "").trim().toLowerCase();
    const issue = errors.find((entry) => String(entry?.return_key || "").trim().toLowerCase() === returnKey);
    if (!issue) continue;

    rowNode.classList.add("requested-check-row-invalid");

    let messageNode = rowNode.querySelector(".requested-check-row-validation-message");
    if (!messageNode) {
      messageNode = document.createElement("div");
      messageNode.className = "requested-check-row-validation-message assignment-brief-text";
      messageNode.style.color = "#b42318";
      messageNode.style.marginTop = "4px";
      const mainRow = rowNode.querySelector(".requested-check-row-main");
      if (mainRow) {
        mainRow.insertAdjacentElement("afterend", messageNode);
      } else {
        rowNode.appendChild(messageNode);
      }
    }
    messageNode.textContent = String(issue?.message || "").trim() || "ข้อมูลไม่ถูกต้อง";
  }
}

function updateAssignmentRequestedCheckReturnRowState(rowNode) {
  if (!rowNode) return;
  const checked = rowNode.querySelector("[data-requested-check-field='checked']")?.checked === true;
  const valueField = rowNode.querySelector("[data-requested-check-field='value']");
  const valueNumberField = rowNode.querySelector("[data-requested-check-field='value-number']");
  const valueUnitField = rowNode.querySelector("[data-requested-check-field='value-unit']");
  const conditionField = rowNode.querySelector("[data-requested-check-field='condition_note']");
  const evidenceField = rowNode.querySelector("[data-requested-check-field='evidence']");
  const multiValueFields = typeof rowNode.querySelectorAll === "function"
    ? Array.from(rowNode.querySelectorAll("[data-requested-check-field='value-multi']"))
    : [];
  if (valueField) valueField.disabled = !checked;
  if (valueNumberField) valueNumberField.disabled = !checked;
  if (valueUnitField) valueUnitField.disabled = !checked;
  multiValueFields.forEach((node) => {
    node.disabled = !checked;
  });
  if (conditionField) conditionField.disabled = !checked;
  if (evidenceField) evidenceField.disabled = !checked;
  rowNode.classList.toggle("is-muted", !checked);
}

function readAssignmentRequestedCheckReturnDraftFromForm(assignmentId) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return null;
  const formNode = qs("assignment-submission-requested-checks-fields");
  if (!formNode) return null;
  const existingRows = state.assignments.requestedCheckReturnDrafts?.[id]?.requested_check_returns;
  const requested_check_returns = existingRows && typeof existingRows === "object"
    ? JSON.parse(JSON.stringify(existingRows))
    : {};
  formNode.querySelectorAll("[data-requested-check-row]").forEach((rowNode) => {
    const returnKey = String(rowNode.getAttribute("data-requested-check-return-key") || "").trim().toLowerCase();
    if (!returnKey) return;
    const existingRow = requested_check_returns[returnKey] && typeof requested_check_returns[returnKey] === "object"
      ? requested_check_returns[returnKey]
      : {};
    const answerType = String(rowNode.getAttribute("data-requested-check-answer-type") || "text").trim().toLowerCase() || "text";
    const groupKey = String(rowNode.getAttribute("data-requested-check-group-key") || "").trim().toLowerCase();
    const checked = rowNode.querySelector("[data-requested-check-field='checked']")?.checked === true;
    let value = null;
    if (groupKey === "taxonomy" && (answerType === "boolean" || answerType === "boolean_with_conditions")) {
      value = checked;
    } else if (answerType === "boolean" || answerType === "boolean_with_conditions") {
      const rawValue = String(rowNode.querySelector("[data-requested-check-field='value']")?.value || "").trim().toLowerCase();
      if (rawValue === "true") value = true;
      else if (rawValue === "false") value = false;
      else value = null;
    } else if (answerType === "multi_select") {
      const structuredValues = typeof rowNode.querySelectorAll === "function"
        ? Array.from(rowNode.querySelectorAll("[data-requested-check-field='value-multi']"))
        .filter((node) => node.checked === true)
        .map((node) => String(node.value || "").trim())
        .filter(Boolean)
        : [];
      value = structuredValues.length
        ? Array.from(new Set(structuredValues))
        : String(rowNode.querySelector("[data-requested-check-field='value']")?.value || "").split("\n").map((part) => String(part || "").trim()).filter(Boolean);
    } else if (answerType === "number_with_unit") {
      const numberValue = String(rowNode.querySelector("[data-requested-check-field='value-number']")?.value || "").trim();
      const unitValue = String(rowNode.querySelector("[data-requested-check-field='value-unit']")?.value || "").trim();
      const numeric = numberValue === "" ? null : Number(numberValue);
      value = numberValue === ""
        ? (unitValue ? { number: null, unit: unitValue || null } : null)
        : (Number.isFinite(numeric) ? { number: numeric, unit: unitValue || null } : null);
    } else if (answerType === "note_only") {
      value = null;
    } else {
      value = String(rowNode.querySelector("[data-requested-check-field='value']")?.value || "").trim();
    }
    const conditionNoteField = rowNode.querySelector("[data-requested-check-field='condition_note']");
    const evidenceField = rowNode.querySelector("[data-requested-check-field='evidence']");
    const noteField = rowNode.querySelector("[data-requested-check-field='note']");
    const condition_note = conditionNoteField
      ? String(conditionNoteField.value || "").trim()
      : String(existingRow.condition_note || "").trim();
    const evidence = evidenceField
      ? String(evidenceField.value || "").trim()
      : String(existingRow.evidence || "").trim();
    const note = noteField
      ? String(noteField.value || "").trim()
      : String(existingRow.note || "").trim();
    requested_check_returns[returnKey] = {
      checked,
      value,
      condition_note,
      evidence,
      note,
      answer_type: answerType,
    };
  });
  return { requested_check_returns };
}

function syncAssignmentRequestedCheckReturnDraftFromForm(assignmentId = state.assignments.selectedId) {
  const id = Number(assignmentId || 0) || 0;
  if (!id) return null;
  const currentDraft = readAssignmentRequestedCheckReturnDraftFromForm(id);
  const handoffPackage = state.assignments.handoffSourcePackages?.[id] || null;
  const normalized = normalizeAssignmentRequestedCheckReturnDraft(currentDraft, handoffPackage);
  setAssignmentRequestedCheckReturnDraftState(id, normalized, { source: "user_edit", dirty: true });
  writeAssignmentSubmissionDraft(id, null, getAssignmentById(id), { includeArticle: false, includeRequestedChecks: true });
  return normalized;
}

function rerenderAssignmentRequestedCheckSurfaces(assignmentId) {
  if (Number(state.assignments.selectedId || 0) !== Number(assignmentId || 0)) return;
  renderAssignmentHandoffBrief();
  const assignment = getAssignmentSubmissionFormAssignment(getAssignmentById(assignmentId), getAssignmentPageMode());
  const handoffPackage = state.assignments.handoffSourcePackages?.[assignmentId] || null;
  renderAssignmentRequestedCheckSection(assignment, handoffPackage);
}

function renderAssignmentHandoffBrief() {
  const node = qs("assignment-handoff-brief");
  if (!node) return;
  const itemId = Number(state.assignments.contextItemId || getAssignmentLandingItemId() || 0) || 0;
  const fieldPack = state.assignments.contextFieldPack && typeof state.assignments.contextFieldPack === "object"
    ? state.assignments.contextFieldPack
    : null;
  if (!itemId) {
    node.className = "assignment-brief-empty";
    node.innerHTML = "เลือกรายการเพื่อดูคำสั่งงานที่จะส่งออก";
    return;
  }
  if (state.assignments.contextFieldPackLoadFailed) {
    node.className = "assignment-brief-empty";
    node.innerHTML = "โหลดชุดคำสั่งงานปัจจุบันไม่สำเร็จ";
    return;
  }
  if (!fieldPack) {
    node.className = "assignment-brief-empty";
    node.innerHTML = "ยังไม่มีชุดคำสั่งงานปัจจุบันของรายการนี้";
    return;
  }

  const summary = String(fieldPack.editor_summary || fieldPack.ai_summary || "").trim();
  const { mustVerify, mustCapture, mustAsk } = getFieldPackPromptGroups(fieldPack);
  const socialHook = String(fieldPack.social_hook || "").trim();
  const socialCaptionAngle = String(fieldPack.social_caption_angle || "").trim();
  const socialShotEmphasis = Array.isArray(fieldPack.social_shot_emphasis_json)
    ? fieldPack.social_shot_emphasis_json.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const socialOnCameraPoints = Array.isArray(fieldPack.social_on_camera_points_json)
    ? fieldPack.social_on_camera_points_json.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  node.className = "assignment-brief-grid";
  node.innerHTML = `
    <div class="assignment-brief-section full-span">
      <div class="assignment-brief-label"><span class="workflow-badge workflow-badge-cleaned">สรุปสั้น</span></div>
      <div class="assignment-brief-text">${summary ? escapeHtml(summary) : '<span class="muted">-</span>'}</div>
    </div>
    <div class="assignment-brief-section">
      <div class="assignment-brief-label"><span class="workflow-badge workflow-badge-generated">ต้องยืนยัน</span></div>
      ${renderAssignmentBriefList(mustVerify, "ยังไม่ได้ระบุ")}
    </div>
    <div class="assignment-brief-section">
      <div class="assignment-brief-label"><span class="workflow-badge workflow-badge-raw">ต้องถาม</span></div>
      ${renderAssignmentBriefList(mustAsk, "ยังไม่ได้ระบุ")}
    </div>
    <div class="assignment-brief-section full-span">
      <div class="assignment-brief-label"><span class="workflow-badge workflow-badge-sent">social</span></div>
      <div class="assignment-brief-text"><strong>จุด hook:</strong> ${socialHook ? escapeHtml(socialHook) : '<span class="muted">-</span>'}</div>
      <div class="assignment-brief-text"><strong>แนว caption:</strong> ${socialCaptionAngle ? escapeHtml(socialCaptionAngle) : '<span class="muted">-</span>'}</div>
      <div class="assignment-brief-label" style="margin-top:8px;">ช็อตที่ควรเน้น</div>
      ${renderAssignmentBriefList(socialShotEmphasis, "ยังไม่ได้ระบุ")}
      <div class="assignment-brief-label" style="margin-top:8px;">ประเด็นพูดหน้ากล้อง</div>
      ${renderAssignmentBriefList(socialOnCameraPoints, "ยังไม่ได้ระบุ")}
    </div>
    <div class="assignment-brief-section full-span">
      <div class="assignment-brief-label"><span class="workflow-badge workflow-badge-cleaned">ต้องถ่าย</span></div>
      ${renderAssignmentBriefList(mustCapture, "ยังไม่ได้ระบุ")}
    </div>
  `;

  const assignmentId = Number(state.assignments.selectedId || 0) || 0;
  const requestedCheckGroups = assignmentId > 0
    ? getAssignmentRequestedCheckGroupsFromHandoffPackage(state.assignments.handoffSourcePackages?.[assignmentId] || null)
    : [];
  if (requestedCheckGroups.length) {
    node.insertAdjacentHTML(
      "beforeend",
      `
        <div class="assignment-brief-section full-span">
          <div class="assignment-brief-label"><span class="workflow-badge workflow-badge-sent">รายการที่ขอ</span></div>
          ${renderAssignmentBriefList(
            requestedCheckGroups.flatMap((group) =>
              (Array.isArray(group.checks) ? group.checks : []).map((check) => `${group.group_label} · ${check.label || check.check_key}`)
            ),
            "ยังไม่มีรายการที่ขอ"
          )}
        </div>
      `
    );
  }
}

function getAssignmentDeliverableLabel(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return ASSIGNMENT_DELIVERABLE_OPTIONS.find((row) => row.value === normalized)?.label || normalized || "-";
}

function getAssignmentDeliverableOptionList(bundle = null, assignment = null) {
  const expected = Array.isArray(bundle?.expected_deliverables) && bundle.expected_deliverables.length > 0
    ? bundle.expected_deliverables
    : normalizeAssignmentBriefExpectedDeliverables(assignment?.brief_json || null);
  const ordered = [];
  const seen = new Set();
  for (const value of [...expected, ...ASSIGNMENT_DELIVERABLE_OPTIONS.map((row) => row.value)]) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function chooseDefaultDeliverableType(bundle = null, assignment = null) {
  const missing = Array.isArray(bundle?.missing_deliverable_types) ? bundle.missing_deliverable_types : [];
  if (missing.length > 0) return String(missing[0] || "").trim().toLowerCase();
  const expected = getAssignmentDeliverableOptionList(bundle, assignment);
  if (expected.length > 0) return expected[0];
  return ASSIGNMENT_DELIVERABLE_OPTIONS[0]?.value || "";
}

function summarizeAssignmentAssetOption(asset) {
  const role = String(asset?.role || "").trim();
  const fileName = String(asset?.file_name || "").trim() || String(asset?.storage_path || "").split(/[\\/]/).pop() || `asset-${Number(asset?.id || 0)}`;
  const parts = [fileName];
  if (role) parts.push(role);
  if (Number(asset?.selected_in_clean || 0) === 1) parts.push("selected");
  if (Number(asset?.is_cover || 0) === 1) parts.push("cover");
  return parts.join(" | ");
}

function findAssignmentAssetById(assetId) {
  const targetId = Number(assetId || 0) || 0;
  if (!targetId) return null;
  return (state.assignments.assetLookup || state.assignments.assets || []).find((row) => Number(row.id || 0) === targetId) || null;
}

function renderAssignmentDeliverableAssetOptions() {
  const select = qs("assignment-deliverable-asset");
  if (!select) return;
  const currentValue = String(select.value || "").trim();
  const rows = Array.isArray(state.assignments.assets) ? state.assignments.assets : [];
  select.innerHTML = ['<option value="">-- ไม่ผูก asset --</option>']
    .concat(
      rows.map((asset) => `<option value="${Number(asset.id || 0)}">${escapeHtml(summarizeAssignmentAssetOption(asset))}</option>`)
    )
    .join("");
  if (rows.some((asset) => String(Number(asset.id || 0)) === currentValue)) {
    select.value = currentValue;
  }
}

function renderAssignmentDeliverableAssetPreview() {
  const node = qs("assignment-deliverable-asset-preview");
  if (!node) return;
  const assetId = Number(qs("assignment-deliverable-asset")?.value || 0) || 0;
  if (!assetId) {
    node.className = "assignment-deliverables-empty";
    node.textContent = "ยังไม่ได้เลือก asset ประกอบ deliverable";
    return;
  }
  const asset = (state.assignments.assets || []).find((row) => Number(row.id || 0) === assetId);
  if (!asset) {
    node.className = "assignment-deliverables-empty";
    node.textContent = "ไม่พบ asset ที่เลือกในรายการปัจจุบัน";
    return;
  }
  const publicUrl = String(asset.public_url || "").trim();
  const meta = [
    String(asset.role || "").trim(),
    Number(asset.selected_in_clean || 0) === 1 ? "selected" : "",
    Number(asset.is_cover || 0) === 1 ? "cover" : "",
  ].filter(Boolean).join(" | ");
  node.className = "assignment-deliverable-asset-preview";
  node.innerHTML = `
    <div class="assignment-deliverable-asset-preview-row">
      ${publicUrl ? `<a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(summarizeAssignmentAssetOption(asset))}</a>` : escapeHtml(summarizeAssignmentAssetOption(asset))}
    </div>
    ${meta ? `<div class="assignment-brief-meta">${escapeHtml(meta)}</div>` : ""}
  `;
}

function formatAssignmentDeliverableSummaryValue(row) {
  const title = String(row?.title || "").trim();
  if (title) return escapeHtml(title);

  const textContent = String(row?.text_content || "").trim();
  if (textContent) return escapeHtml(textContent.slice(0, 140));

  const sourceUrl = String(row?.source_url || "").trim();
  if (sourceUrl) return escapeHtml(sourceUrl);

  const sourceAssetId = Number(row?.source_asset_id || 0) || 0;
  if (sourceAssetId) {
    const asset = findAssignmentAssetById(sourceAssetId);
    if (asset) {
      const label = summarizeAssignmentAssetOption(asset);
      const publicUrl = String(asset.public_url || "").trim();
      return publicUrl
        ? `<a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
        : escapeHtml(label);
    }
    return `Asset #${sourceAssetId}`;
  }

  return "-";
}

function renderAssignmentDeliverableTypeOptions(bundle = null, assignment = null) {
  const select = qs("assignment-deliverable-type");
  if (!select) return;
  const currentValue = String(select.value || "").trim().toLowerCase();
  const optionValues = getAssignmentDeliverableOptionList(bundle, assignment);
  const defaultValue = chooseDefaultDeliverableType(bundle, assignment);
  select.innerHTML = ['<option value="">-- เลือกประเภทงานส่ง --</option>']
    .concat(
      optionValues.map((value) => {
        const expected = Array.isArray(bundle?.expected_deliverables) && bundle.expected_deliverables.includes(value);
        const suffix = expected ? " (คาดหวัง)" : "";
        return `<option value="${escapeHtml(value)}">${escapeHtml(getAssignmentDeliverableLabel(value) + suffix)}</option>`;
      })
    )
    .join("");
  select.value = optionValues.includes(currentValue) ? currentValue : defaultValue;
}

function formatAssignmentDeliverableStatusChip(type, status) {
  const normalized = String(status || "").trim().toLowerCase();
  const label = getAssignmentDeliverableLabel(type);
  const className = normalized === "ready"
    ? "assignment-deliverable-chip is-ready"
    : normalized === "missing"
      ? "assignment-deliverable-chip is-missing"
      : "assignment-deliverable-chip";
  return `<span class="${className}">${escapeHtml(label)}</span>`;
}

function summarizeAssignmentDeliverableList(type, list = []) {
  const normalizedType = String(type || "").trim().toLowerCase();
  const rows = Array.isArray(list) ? list : [];
  const count = rows.length;
  if (!count) return "";

  if (normalizedType === "photos" || normalizedType === "videos") {
    return `${getAssignmentDeliverableLabel(normalizedType)} ${count} รายการ`;
  }

  if (count === 1) {
    return formatAssignmentDeliverableSummaryValue(rows[0]);
  }

  return `${getAssignmentDeliverableLabel(normalizedType)} ${count} รายการ`;
}

function formatAssignmentDeliverableRowMeta(type, list = []) {
  const normalizedType = String(type || "").trim().toLowerCase();
  const rows = Array.isArray(list) ? list : [];
  if (!rows.length) return "";
  const latestUpdatedAt = rows
    .map((row) => String(row?.updated_at || row?.created_at || "").trim())
    .find(Boolean);
  const statuses = Array.from(new Set(rows.map((row) => String(row?.status || "").trim()).filter(Boolean)));
  const parts = [`${rows.length} รายการ`];
  if (statuses.length === 1) parts.push(`status=${statuses[0]}`);
  if (latestUpdatedAt) parts.push(`อัปเดตล่าสุด ${latestUpdatedAt}`);
  if (rows.length > 1 && (normalizedType === "photos" || normalizedType === "videos")) {
    parts.push("แสดงครบทุกไฟล์ใน review panel");
  }
  return parts.join(" | ");
}

function renderAssignmentDeliverablesSummary(bundle = null, assignment = null) {
  const node = qs("assignment-deliverables-summary");
  const metaNode = qs("assignment-deliverables-meta");
  const createBtn = qs("btn-assignment-create-deliverable");
  if (!node || !metaNode) return;
  if (!assignment) {
    if (createBtn) createBtn.disabled = true;
    metaNode.textContent = "ยังไม่ได้เลือกงานในกระบวนการนี้";
    node.className = "assignment-deliverables-empty";
    node.innerHTML = "ยังไม่มีข้อมูลงานส่งของงานที่เลือก";
    renderAssignmentDeliverableTypeOptions(null, null);
    return;
  }

  if (!bundle || typeof bundle !== "object") {
    const latestSubmissionId = Number(assignment.latest_submission_id || 0) || null;
    if (createBtn) createBtn.disabled = !latestSubmissionId;
    metaNode.textContent = latestSubmissionId
      ? `งาน #${Number(assignment.id || 0)} | รอบส่งล่าสุด #${latestSubmissionId}`
      : `งาน #${Number(assignment.id || 0)} | ยังไม่มีรอบส่งล่าสุด`;
    node.className = "assignment-deliverables-empty";
    node.innerHTML = latestSubmissionId
      ? "ยังโหลดข้อมูลงานส่งของรอบล่าสุดไม่สำเร็จ"
      : "ยังไม่มีรอบส่งล่าสุด จึงยังเพิ่มงานส่งไม่ได้";
    renderAssignmentDeliverableTypeOptions(null, assignment);
    return;
  }

  const expected = Array.isArray(bundle.expected_deliverables) ? bundle.expected_deliverables : [];
  const available = Array.isArray(bundle.available_deliverable_types) ? bundle.available_deliverable_types : [];
  const fulfilledExpected = expected.filter((type) => available.includes(type));
  const missing = Array.isArray(bundle.missing_deliverable_types) ? bundle.missing_deliverable_types : [];
  const latestSubmissionId = Number(bundle.latest_submission_id || assignment.latest_submission_id || 0) || null;
  const deliverablesByType = bundle.deliverables_by_type && typeof bundle.deliverables_by_type === "object"
    ? bundle.deliverables_by_type
    : {};
  if (createBtn) createBtn.disabled = !latestSubmissionId;
  metaNode.textContent = latestSubmissionId
    ? `รอบส่งล่าสุด #${latestSubmissionId} | ครบแล้ว ${fulfilledExpected.length} จาก ${expected.length} ประเภท${missing.length > 0 ? ` | ยังขาด ${missing.length} ประเภท` : ""}`
    : "ยังไม่มีรอบส่งล่าสุด";

  const rows = [];
  for (const type of available) {
    const list = Array.isArray(deliverablesByType[type]) ? deliverablesByType[type] : [];
    if (!list.length) continue;
    rows.push(`
      <div class="assignment-deliverable-row">
        <div class="assignment-deliverable-row-head">
          ${formatAssignmentDeliverableStatusChip(type, "ready")}
          <span class="assignment-deliverable-row-status">มีข้อมูลจริงในรอบส่งล่าสุด</span>
        </div>
        <div class="assignment-deliverable-row-body">
          <div>${summarizeAssignmentDeliverableList(type, list)}</div>
          <div class="assignment-brief-meta">${escapeHtml(formatAssignmentDeliverableRowMeta(type, list))}</div>
        </div>
      </div>
    `);
  }

  node.className = "assignment-deliverables-summary";
  node.innerHTML = `
    <div class="assignment-deliverables-overview">
      <div>
        <div class="assignment-brief-label">สิ่งที่คาดหวัง</div>
        ${formatAssignmentBriefExpectedDeliverables(expected)}
      </div>
      <div>
        <div class="assignment-brief-label">ครบแล้ว ${fulfilledExpected.length} จาก ${expected.length} ประเภท</div>
        ${formatAssignmentBriefExpectedDeliverables(fulfilledExpected)}
      </div>
      <div>
        <div class="assignment-brief-label">ยังขาด ${missing.length} ประเภท</div>
        ${formatAssignmentBriefExpectedDeliverables(missing)}
      </div>
    </div>
    <div class="assignment-deliverables-rows">
      ${rows.length ? rows.join("") : '<div class="muted">ยังไม่มี deliverable ที่มีข้อมูลจริงในรอบส่งล่าสุด</div>'}
    </div>
  `;
  renderAssignmentDeliverableTypeOptions(bundle, assignment);
}

function getAssignmentById(assignmentId) {
  const id = Number(assignmentId || 0);
  if (!id) return null;
  const rows = Array.isArray(state.assignments.rows) ? state.assignments.rows : [];
  const managedRows = Array.isArray(state.assignments.managedRows) ? state.assignments.managedRows : [];
  const submittedRows = Array.isArray(state.assignments.submittedRows) ? state.assignments.submittedRows : [];
  return rows.find((row) => Number(row.id || 0) === id)
    || submittedRows.find((row) => Number(row.id || 0) === id)
    || managedRows.find((row) => Number(row.id || 0) === id)
    || null;
}

function markAssignmentExpectedDeliverablesTouched() {
  state.assignments.expectedDeliverablesTouched = true;
}

function resetAssignmentExpectedDeliverablesTouched() {
  state.assignments.expectedDeliverablesTouched = false;
}

function renderAssignmentStateBadge(stateValue) {
  const raw = String(stateValue || "").trim();
  const text = raw || "-";
  const tone = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return `<span class="as-status-badge as-status-${escapeHtml(tone || "unknown")}">${escapeHtml(text)}</span>`;
}

function renderManagedAssignmentsTable(rows) {
  const wrap = qs("assignment-managed-list-wrap");
  const titleNode = qs("assignment-managed-list-title");
  const noteNode = qs("assignment-managed-list-note");
  const table = qs("table-assignments-managed");
  const pageMode = getAssignmentPageMode();
  const canShow = pageMode === "work" && canSeeManagedAssignmentsTable();
  if (wrap) wrap.classList.toggle("hidden", !canShow);
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const thead = table.querySelector("thead");
  if (!tbody || !thead) return;

  if (!canShow) {
    tbody.innerHTML = "";
    return;
  }

  if (titleNode) {
    titleNode.textContent = "งานที่ฉันดูแล";
  }
  if (noteNode) {
    noteNode.textContent = currentRole() === "owner"
      ? "owner เห็นงานทั้งหมดในระบบ ตารางนี้ใช้ดูผู้รับงาน สถานะ และกำหนดส่ง"
      : "ใช้ติดตามงานในความรับผิดชอบของคุณ และเปิดใบสั่งงานได้ทันที";
  }

  thead.innerHTML = `
    <tr>
      <th>ID</th>
      <th>ชื่อคอนเทนต์</th>
      <th>Assignee</th>
      <th>State</th>
      <th>Due</th>
      <th>การทำงาน</th>
    </tr>
  `;
  tbody.innerHTML = "";

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="6" class="muted">ยังไม่มีงานใน scope ที่คุณดูแล</td>';
    tbody.appendChild(tr);
    return;
  }

  list.forEach((row) => {
    const id = Number(row?.id || 0) || 0;
    const isSelected = Number(state.assignments.selectedId || 0) === id;
    const { itemId, title } = getAssignmentContentItemMeta(row);
    const tr = document.createElement("tr");
    tr.className = isSelected ? "row-selected" : "";
    tr.innerHTML = `
      <td>${itemId || "-"}</td>
      <td>${escapeHtml(title)}</td>
      <td>${escapeHtml(getAssignmentAssigneeLabel(row))}</td>
      <td>${renderAssignmentStateBadge(row.state)}</td>
      <td>${escapeHtml(formatAssignmentDueAtLabel(row.due_at))}</td>
      <td class="action-stack">
        <a href="${escapeHtml(buildAssignmentBriefUrl(itemId, id))}">ดูใบสั่งงาน</a>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderSubmittedAssignmentsTable(rows) {
  const wrap = qs("assignment-submitted-list-wrap");
  const titleNode = qs("assignment-submitted-list-title");
  const noteNode = qs("assignment-submitted-list-note");
  const table = qs("table-assignments-submitted");
  const pageMode = getAssignmentPageMode();
  const canShow = pageMode === "work";
  if (wrap) wrap.classList.toggle("hidden", !canShow);
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const thead = table.querySelector("thead");
  if (!tbody || !thead) return;

  if (!canShow) {
    tbody.innerHTML = "";
    return;
  }

  if (titleNode) {
    titleNode.textContent = "งานที่ฉันส่งแล้ว / รอตรวจ";
  }
  if (noteNode) {
    noteNode.textContent = "รายการนี้มีเฉพาะงานที่ account นี้ส่งเองแล้ว ใช้ดูสิ่งที่ส่งกลับล่าสุดและสถานะการรอตรวจ";
  }

  thead.innerHTML = `
    <tr>
      <th>ID</th>
      <th>ชื่อคอนเทนต์</th>
      <th>Assignee</th>
      <th>State</th>
      <th>Due</th>
      <th>การทำงาน</th>
    </tr>
  `;
  tbody.innerHTML = "";

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="6" class="muted">ยังไม่มีงานที่ส่งแล้วในกระบวนการนี้</td>';
    tbody.appendChild(tr);
    return;
  }

  list.forEach((row) => {
    const id = Number(row?.id || 0) || 0;
    const isSelected = Number(state.assignments.selectedId || 0) === id && Number(state.assignments.submittedSelectionId || 0) === id;
    const { itemId, title } = getAssignmentContentItemMeta(row);
    const tr = document.createElement("tr");
    tr.className = isSelected ? "row-selected" : "";
    tr.innerHTML = `
      <td>${itemId || "-"}</td>
      <td>${escapeHtml(title)}</td>
      <td>${escapeHtml(getAssignmentAssigneeLabel(row))}</td>
      <td>${renderAssignmentStateBadge(row?.state)}</td>
      <td>${escapeHtml(formatAssignmentDueAtLabel(row?.due_at))}</td>
      <td class="action-stack">
        <button type="button" data-action="open-submitted-assignment" data-id="${id}">ดูงานที่ส่งแล้ว</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderAssignmentsTable(rows) {
  const table = qs("table-assignments");
  if (!table) return;
  const listTitle = qs("assignment-list-title");
  const listNote = qs("assignment-list-note");
  const actionableTitle = qs("assignment-actionable-list-title");
  const actionableNote = qs("assignment-actionable-list-note");
  const submittedWrap = qs("assignment-submitted-list-wrap");
  const loadBtn = qs("btn-assignments-load");
  const pageMode = getAssignmentPageMode();
  const tbody = table.querySelector("tbody");
  const thead = table.querySelector("thead");
  if (!tbody || !thead) return;

  if (pageMode === "handoff") {
    const queue = getAssignmentHandoffQueueItems();
    const selectedItemId = Number(state.assignments.contextItemId || getAssignmentLandingItemId() || 0) || 0;
    const selectedItem = selectedItemId ? findLoadedItemById(selectedItemId) : null;
    const selectedItemInQueue = selectedItemId > 0 && queue.some((item) => Number(item?.id || 0) === selectedItemId);
    if (listTitle) {
      listTitle.textContent = "กระบวนการ 2 · ขั้น 1: เลือกงานที่พร้อมส่งไปทำ";
    }
    if (listNote) {
      listNote.textContent = "รายการในคิวนี้คือ item ที่จบตรวจแก้และจัดชุดสั่งงานแล้ว พร้อมส่งเข้า handoff และยังไม่ถูกส่งออกไปทำ";
    }
    if (loadBtn) {
      loadBtn.classList.add("hidden");
    }
    if (actionableTitle) {
      actionableTitle.classList.add("hidden");
    }
    if (actionableNote) {
      actionableNote.classList.add("hidden");
    }
    if (submittedWrap) {
      submittedWrap.classList.add("hidden");
    }
    thead.innerHTML = `
      <tr>
        <th>Item</th>
        <th>ชื่อคอนเทนต์</th>
        <th>หมวดหมู่</th>
        <th>สถานะปัจจุบัน</th>
        <th>Updated</th>
        <th>การทำงาน</th>
      </tr>
    `;
    tbody.innerHTML = "";

    if (selectedItem && !selectedItemInQueue) {
      const tr = document.createElement("tr");
      tr.className = "row-selected";
      tr.innerHTML = `
        <td>${selectedItemId || "-"}</td>
        <td>${escapeHtml(String(selectedItem?.title || "").trim() || "-")}</td>
        <td>${escapeHtml(toCategoryLabel(selectedItem?.category))}</td>
        <td>
          ${renderHandoffQueueStatusBadge(selectedItem)}
          <div class="muted" style="margin-top:4px;">รายการนี้ถูกเปิดมาจากหน้า editor แต่ไม่ได้อยู่ในคิวพร้อมส่งตอนนี้</div>
        </td>
        <td>${escapeHtml(String(selectedItem?.updated_at || selectedItem?.created_at || "-").trim() || "-")}</td>
        <td class="action-stack">
          <button type="button" data-action="open-handoff-item" data-id="${selectedItemId}">เปิดงานที่เลือก</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    if (!queue.length && !(selectedItem && !selectedItemInQueue)) {
      const tr = document.createElement("tr");
      tr.innerHTML = '<td colspan="6" class="muted">ยังไม่มีงานที่พร้อมส่งไปทำ</td>';
      tbody.appendChild(tr);
      tbody.onclick = null;
      return;
    }

    queue.forEach((item) => {
      const id = Number(item?.id || 0) || 0;
      const tr = document.createElement("tr");
      tr.className = selectedItemId === id ? "row-selected" : "";
      tr.innerHTML = `
        <td>${id || "-"}</td>
        <td>${escapeHtml(String(item?.title || "").trim() || "-")}</td>
        <td>${escapeHtml(toCategoryLabel(item?.category))}</td>
        <td>${renderHandoffQueueStatusBadge(item)}</td>
        <td>${escapeHtml(String(item?.updated_at || item?.created_at || "-").trim() || "-")}</td>
        <td class="action-stack">
          <button type="button" data-action="open-handoff-item" data-id="${id}">1.1 เลือกงาน</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.onclick = async (event) => {
      const btn = event.target.closest('button[data-action="open-handoff-item"]');
      if (!btn) return;
      const id = Number(btn.dataset.id || 0) || 0;
      if (!id) return;
      await selectAssignmentContextItem(id);
    };
    return;
  }

  const list = Array.isArray(rows) ? rows : [];
  if (listTitle) {
    listTitle.textContent = pageMode === "review"
      ? isOwnerReviewTrackingEnabled()
        ? "กระบวนการ 2: ติดตามงานที่ส่งกลับมาและงานที่ปิดรอบแล้ว"
        : "กระบวนการ 2: เลือกงานที่ส่งกลับมาเพื่อตรวจ"
      : pageMode === "work"
        ? "กระบวนการ 2: งานในขั้นลงงาน"
        : "กระบวนการ 2: งานในกระบวนการนี้";
  }
  if (listNote) {
    listNote.textContent = pageMode === "review"
      ? isOwnerReviewTrackingEnabled()
        ? "owner ใช้มุมนี้เพื่อติดตามทั้งงานที่รอตรวจ งานที่ส่งกลับแก้ และงานที่ตรวจผ่านแล้ว"
        : "เลือกงานที่ส่งกลับมาแล้วเพื่อเปิดตรวจ ขอแก้ หรือรับงานผ่าน"
      : pageMode === "work"
        ? "แยกงานที่ต้องทำ งานที่ส่งแล้ว และงานที่ดูแลออกจากกัน เพื่อไม่ให้สถานะปนกัน"
        : "เลือกผู้ลงงานในระบบเพื่อกรองรายการ หรือปล่อยว่างเพื่อใช้มุมมองเริ่มต้นของ role นี้";
    if (isAssignmentWorkOnlyUser() && pageMode === "work") {
      listNote.textContent = "แสดงงานที่ต้องทำและงานที่ส่งแล้วของคุณเท่านั้น";
    }
  }
  if (actionableTitle) {
    actionableTitle.classList.toggle("hidden", pageMode !== "work");
  }
  if (actionableNote) {
    actionableNote.classList.toggle("hidden", pageMode !== "work");
  }
  if (submittedWrap) {
    submittedWrap.classList.toggle("hidden", pageMode !== "work");
  }
  if (loadBtn) {
    loadBtn.classList.remove("hidden");
    loadBtn.textContent = pageMode === "work" ? "โหลดรายการงาน" : "1.1 โหลดงานในกระบวนการนี้";
  }
  thead.innerHTML = `
    <tr>
      <th>ID</th>
      <th>ชื่อคอนเทนต์</th>
      <th>Assignee</th>
      <th>State</th>
      <th>Due</th>
      <th>การทำงาน</th>
    </tr>
  `;
  tbody.innerHTML = "";

  if (!list.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="6" class="muted">ยังไม่มีงานในกระบวนการนี้</td>';
    tbody.appendChild(tr);
  }

  list.forEach((row) => {
    const id = Number(row.id || 0);
    const isSelected = Number(state.assignments.selectedId || 0) === id;
    const assigneeLabel = getAssignmentAssigneeLabel(row);
    const { itemId, title } = getAssignmentContentItemMeta(row);
    const tr = document.createElement("tr");
    tr.className = isSelected ? "row-selected" : "";
    tr.innerHTML = `
      <td>${itemId || "-"}</td>
      <td>${escapeHtml(title)}</td>
      <td>${escapeHtml(assigneeLabel)}</td>
      <td>${renderAssignmentStateBadge(row.state)}</td>
      <td>${escapeHtml(formatAssignmentDueAtLabel(row.due_at))}</td>
      <td class="action-stack">
        <button type="button" data-action="open-assignment" data-id="${id}">เปิดงาน</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function selectAssignment(assignmentId, { trackOnly = false, submittedView = false } = {}) {
  const previousAssignmentId = Number(state.assignments.selectedId || 0);
  const assignment = getAssignmentById(assignmentId);
  if (!assignment) {
    const contextItem = getAssignmentContextItem();
    const pageMode = getAssignmentPageMode();
    state.assignments.selectedId = null;
    state.assignments.trackOnlySelectionId = null;
    state.assignments.submittedSelectionId = null;
    state.assignments.reviewSelectedVideoKey = "";
    state.assignments.deliverablesBundle = null;
    state.assignments.workLatestComment = "";
    state.assignments.workLatestCommentLoaded = false;
    state.assignments.workLatestCommentLoading = false;
    state.assignments.latestUploadedAssets = [];
    state.assignments.latestUploadedAssetsKey = "";
    state.assignments.assets = [];
    state.assignments.assetLookup = [];
    resetAssignmentExpectedDeliverablesTouched();
    setAssignmentDetailVisible(pageMode === "handoff" && Boolean(contextItem));
    setAssignmentProcessGuide(null);
    qs("assignment-selected-summary").textContent = contextItem
      ? `กำลังเตรียมส่งงานสำหรับ item #${Number(contextItem.id || 0)} · ${String(contextItem.title || "").trim() || "-"}`
      : "ยังไม่ได้เลือกงานในกระบวนการนี้";
    renderAssignmentContextBrief(null);
    syncAssignmentWorkflowLayout(null);
    renderAssignmentDeliverablesSummary(null, null);
    renderAssignmentReviewSummary(null);
    renderAssignmentReviewSubmissionContent(null);
    renderAssignmentDeliverableAssetOptions();
    renderAssignmentDeliverableAssetPreview();
    renderAssignmentSubmissionForm(null);
    updateAssignmentActionControls(null);
    setJsonPreview("assignment-selected-json", null);
    return null;
  }

  const nextAssignmentId = Number(assignment.id || 0);
  const contentItemId = Number(assignment.content_item_id || 0) || 0;
  const pageMode = getAssignmentPageMode();
  const previousContextItemId = Number(state.assignments.contextItemId || 0) || 0;
  const isSwitchingItemContext = contentItemId > 0 && previousContextItemId > 0 && previousContextItemId !== contentItemId;
  if (previousAssignmentId && previousAssignmentId !== nextAssignmentId) {
    resetAssignmentExpectedDeliverablesTouched();
    state.assignments.reviewSelectedVideoKey = "";
  }
  state.assignments.selectedId = Number(assignment.id || 0);
  state.assignments.trackOnlySelectionId = pageMode === "work" && trackOnly ? nextAssignmentId : null;
  state.assignments.submittedSelectionId = pageMode === "work" && submittedView ? nextAssignmentId : null;
  if (contentItemId) {
    state.assignments.contextItemId = contentItemId;
  }
  if (isSwitchingItemContext) {
    state.assignments.contextFieldPackStatus = "";
    state.assignments.contextFieldPack = null;
    state.assignments.contextFieldPackLoadFailed = false;
  }
  state.assignments.workLatestComment = "";
  state.assignments.workLatestCommentLoaded = false;
  state.assignments.workLatestCommentLoading = false;
  state.assignments.latestUploadedAssets = [];
  state.assignments.latestUploadedAssetsKey = "";
  if (Number(state.assignments.deliverablesBundle?.assignment_id || 0) !== Number(assignment.id || 0)) {
    state.assignments.deliverablesBundle = null;
  }
  state.assignments.assets = [];
  state.assignments.assetLookup = [];
  renderAssignmentDeliverableAssetOptions();
  renderAssignmentDeliverableAssetPreview();
  setAssignmentDetailVisible(true);
  setAssignmentProcessGuide(assignment);
  qs("assignment-selected-summary").textContent = summarizeAssignment(assignment);
  renderAssignmentContextBrief(assignment);
  renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(assignment, pageMode));
  syncAssignmentWorkflowLayout(assignment);
  renderAssignmentDeliverablesSummary(state.assignments.deliverablesBundle, assignment);
  renderAssignmentReviewSummary(assignment);
  renderAssignmentReviewSubmissionContent(assignment);
  updateAssignmentActionControls(assignment);
  setJsonPreview("assignment-selected-json", assignment);
  const expectedDeliverablesInput = qs("assignment-expected-deliverables");
  if (expectedDeliverablesInput) {
    const expectedDeliverables = normalizeAssignmentBriefExpectedDeliverables(assignment?.brief_json || null);
    if (!state.assignments.expectedDeliverablesTouched) {
      expectedDeliverablesInput.value = expectedDeliverables.join(",");
    }
  }

  renderAssignmentsTable(state.assignments.rows);
  renderSubmittedAssignmentsTable(state.assignments.submittedRows);
  if (contentItemId) {
    const rerenderSelectedAssignment = () => {
      if (Number(state.assignments.selectedId || 0) !== nextAssignmentId) return;
      const selectedAssignment = getAssignmentById(nextAssignmentId) || assignment;
      setAssignmentRoleVisibility();
      renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(selectedAssignment, pageMode));
      syncAssignmentWorkflowLayout(selectedAssignment);
    };
    loadAssignmentContextFieldPackStatus(contentItemId)
      .then(() => {
        rerenderSelectedAssignment();
      })
      .catch(() => {
        rerenderSelectedAssignment();
      });
  }
  if (!isEditorUser()) {
    loadAssignmentRequestedCheckHandoffSource(assignment).catch(() => {});
    loadAssignmentDeliverablesBundle({ showStatus: false }).catch(() => {
      state.assignments.deliverablesBundle = null;
      renderAssignmentDeliverablesSummary(null, assignment);
    });
    ensureAssignmentSubmissionPrefillLoaded(assignment).catch(() => {});
  }
  loadAssignmentAssets({ showStatus: false }).catch(() => {
    state.assignments.assets = [];
    state.assignments.assetLookup = [];
    renderAssignmentDeliverableAssetOptions();
    renderAssignmentDeliverableAssetPreview();
  });
  if (getAssignmentPageMode() === "work") {
    loadAssignmentLatestWorkComment().catch(() => {
      state.assignments.workLatestComment = "";
      state.assignments.workLatestCommentLoaded = true;
      state.assignments.workLatestCommentLoading = false;
      if (Number(state.assignments.selectedId || 0) === nextAssignmentId) {
        syncAssignmentPageMode(assignment);
      }
    });
  }
  return assignment;
}

function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function buildEvaluatePayloadFromForm() {
  const payload = {};
  const expected = parseCommaList(qs("assignment-expected-deliverables")?.value);
  if (expected.length) {
    payload.expected_deliverables = expected;
  }

  const reasonCode = String(qs("assignment-evaluate-reason")?.value || "").trim().toLowerCase();
  if (reasonCode) {
    payload.reason_code = reasonCode;
  }
  const reviewNote = String(qs("assignment-review-note")?.value || "").trim();
  if (reviewNote) {
    payload.contributor_note = reviewNote;
  }
  const imageResetRequired = Boolean(qs("assignment-review-image-reset")?.checked);
  const videoResetRequired = Boolean(qs("assignment-review-video-reset")?.checked);
  const imageResetReason = String(qs("assignment-review-image-reset-reason")?.value || "").trim();
  const videoResetReason = String(qs("assignment-review-video-reset-reason")?.value || "").trim();
  payload.image_reset_required = imageResetRequired;
  payload.video_reset_required = videoResetRequired;
  if (imageResetReason) payload.image_reset_reason = imageResetReason;
  if (videoResetReason) payload.video_reset_reason = videoResetReason;

  return payload;
}

function syncAssignmentReviewResetReasonUI() {
  const imageResetCheckbox = qs("assignment-review-image-reset");
  const imageResetReason = qs("assignment-review-image-reset-reason");
  const videoResetCheckbox = qs("assignment-review-video-reset");
  const videoResetReason = qs("assignment-review-video-reset-reason");
  const imageRequired = Boolean(imageResetCheckbox?.checked);
  const videoRequired = Boolean(videoResetCheckbox?.checked);
  if (imageResetReason) {
    imageResetReason.required = imageRequired;
    imageResetReason.disabled = !imageRequired;
    if (!imageRequired) imageResetReason.value = "";
  }
  if (videoResetReason) {
    videoResetReason.required = videoRequired;
    videoResetReason.disabled = !videoRequired;
    if (!videoRequired) videoResetReason.value = "";
  }
}

async function applyAssignmentReviewDecision(action) {
  if (!canPatchAssignmentState()) {
    throw new Error("role นี้ไม่มีสิทธิ์ตรวจงานนี้");
  }
  const assignmentId = ensureSelectedAssignmentId();
  const selectedAction = String(action || "").trim().toLowerCase();
  if (selectedAction !== "request_revision" && selectedAction !== "accept_submission") {
    throw new Error("action ตรวจงานไม่ถูกต้อง");
  }
  const payload = buildEvaluatePayloadFromForm();
  if (selectedAction === "request_revision") {
    if (payload.image_reset_required && !String(payload.image_reset_reason || "").trim()) {
      throw new Error("กรุณากรอกเหตุผลการรีเซ็ตรูป");
    }
    if (payload.video_reset_required && !String(payload.video_reset_reason || "").trim()) {
      throw new Error("กรุณากรอกเหตุผลการรีเซ็ตวิดีโอ");
    }
  } else {
    delete payload.image_reset_required;
    delete payload.image_reset_reason;
    delete payload.video_reset_required;
    delete payload.video_reset_reason;
  }
  payload.action = selectedAction;
  const result = await api(`/api/assignments/${assignmentId}/state`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  setJsonPreview("assignment-evaluate-json", result);
  const nextState = String(result?.assignment?.state || "").trim().toLowerCase();
  setStatus(
    "assignment-status",
    selectedAction === "request_revision"
      ? `ขอแก้เพิ่มสำหรับงาน #${assignmentId} แล้ว (${nextState || "revision_requested"})`
      : `รับงาน #${assignmentId} ผ่านแล้ว (${nextState || "accepted"})`
  );
  await refreshAssignments({ showStatus: false, preserveSelection: true });
  setJsonPreview("assignment-selected-json", result?.assignment || getAssignmentById(assignmentId));
}

function buildAssignmentDeliverablePayloadFromForm() {
  const deliverableType = String(qs("assignment-deliverable-type")?.value || "").trim().toLowerCase();
  if (!deliverableType) {
    throw new Error("กรุณาเลือกประเภทงานส่งที่จะเพิ่ม");
  }
  const rawStatus = String(qs("assignment-deliverable-status")?.value || "submitted").trim().toLowerCase();
  const allowedStatus = rawStatus === "draft" ? "draft" : "submitted";
  const payload = {
    deliverable_type: deliverableType,
    status: allowedStatus,
    lang: String(qs("assignment-deliverable-lang")?.value || "th").trim().toLowerCase() || "th",
  };
  const title = String(qs("assignment-deliverable-title")?.value || "").trim();
  if (title) payload.title = title;
  const sourceUrl = String(qs("assignment-deliverable-source-url")?.value || "").trim();
  if (sourceUrl) payload.source_url = sourceUrl;
  const sourceAssetId = Number(qs("assignment-deliverable-asset")?.value || 0) || 0;
  if (sourceAssetId > 0) payload.source_asset_id = sourceAssetId;
  const textContent = String(qs("assignment-deliverable-text")?.value || "").trim();
  if (textContent) payload.text_content = textContent;
  const reasonCode = String(qs("assignment-deliverable-reason")?.value || "").trim().toLowerCase();
  if (reasonCode) payload.reason_code = reasonCode;

  const isTextLike = deliverableType === "raw_notes"
    || deliverableType === "caption_draft"
    || deliverableType === "script_draft"
    || deliverableType === "article_draft";
  if (isTextLike && !textContent && !sourceUrl) {
    throw new Error("deliverable แบบข้อความต้องมี text_content หรือ source_url อย่างน้อยหนึ่งอย่าง");
  }
  if ((deliverableType === "photos" || deliverableType === "videos") && !sourceUrl && !sourceAssetId && !title && !textContent) {
    throw new Error("deliverable แบบภาพ/วิดีโอควรมีอย่างน้อย asset, source_url หรือคำอธิบาย");
  }
  return payload;
}

async function refreshAssignments({ showStatus = true, preserveSelection = true } = {}) {
  if (!state.user) {
      state.assignments.rows = [];
      state.assignments.managedRows = [];
      state.assignments.submittedRows = [];
      state.assignments.selectedId = null;
      state.assignments.trackOnlySelectionId = null;
      state.assignments.submittedSelectionId = null;
      state.assignments.deliverablesBundle = null;
      state.assignments.assets = [];
      state.assignments.assetLookup = [];
      renderManagedAssignmentsTable([]);
      renderAssignmentsTable([]);
      renderSubmittedAssignmentsTable([]);
      setAssignmentDetailVisible(false);
      setAssignmentProcessGuide(null);
      renderAssignmentDeliverablesSummary(null, null);
      renderAssignmentDeliverableAssetOptions();
      renderAssignmentDeliverableAssetPreview();
      return [];
  }

  try {
    const pageMode = getAssignmentPageMode();
    const actionablePath = buildAssignmentsMinePath();
    const managedPath = pageMode === "work" ? buildAssignmentsManagedPath() : "";
    const submittedPath = pageMode === "work" ? buildAssignmentsSubmittedPath() : "";
    const [response, managedResponse, submittedResponse] = await Promise.all([
      api(actionablePath),
      managedPath ? api(managedPath) : Promise.resolve({ assignments: [] }),
      submittedPath ? api(submittedPath) : Promise.resolve({ assignments: [] }),
    ]);
    const rows = Array.isArray(response?.assignments) ? response.assignments : [];
    const managedRows = Array.isArray(managedResponse?.assignments) ? managedResponse.assignments : [];
    const submittedRows = Array.isArray(submittedResponse?.assignments) ? submittedResponse.assignments : [];
    const previousSelection = Number(state.assignments.selectedId || 0);
    const previousTrackOnlySelection = Number(state.assignments.trackOnlySelectionId || 0);
    const previousSubmittedSelection = Number(state.assignments.submittedSelectionId || 0);
    const landingAssignmentId = getAssignmentLandingAssignmentId();
    state.assignments.rows = rows;
    state.assignments.managedRows = managedRows;
    state.assignments.submittedRows = submittedRows;
    renderManagedAssignmentsTable(managedRows);
    renderAssignmentsTable(rows);
    renderSubmittedAssignmentsTable(submittedRows);
    const selectableRows = [...rows, ...submittedRows, ...managedRows];

    if ((pageMode === "work" && rows.length === 0 && submittedRows.length === 0) || selectableRows.length === 0) {
      state.assignments.selectedId = null;
      state.assignments.trackOnlySelectionId = null;
      state.assignments.submittedSelectionId = null;
      state.assignments.deliverablesBundle = null;
      state.assignments.assets = [];
      state.assignments.assetLookup = [];
      resetAssignmentExpectedDeliverablesTouched();
      setAssignmentDetailVisible(false);
      setAssignmentProcessGuide(null);
      renderAssignmentAssigneeSelectionSummary("ยังไม่มีงานในกระบวนการนี้");
      renderAssignmentContextBrief(null);
      syncAssignmentWorkflowLayout(null);
      renderAssignmentDeliverablesSummary(null, null);
      renderAssignmentDeliverableAssetOptions();
      renderAssignmentDeliverableAssetPreview();
      renderAssignmentSubmissionForm(null);
      setJsonPreview("assignment-selected-json", null);
    } else if (
      landingAssignmentId
      && (
        (pageMode === "work" && [...rows, ...submittedRows].some((row) => Number(row.id || 0) === landingAssignmentId))
        || (pageMode !== "work" && selectableRows.some((row) => Number(row.id || 0) === landingAssignmentId))
      )
    ) {
      const openSubmittedLanding = pageMode === "work" && submittedRows.some((row) => Number(row.id || 0) === landingAssignmentId);
      selectAssignment(landingAssignmentId, openSubmittedLanding ? { submittedView: true } : {});
    } else if (preserveSelection && previousSelection) {
      const stillExistsInActionable = rows.some((row) => Number(row.id || 0) === previousSelection);
      const stillExistsInSubmitted = submittedRows.some((row) => Number(row.id || 0) === previousSelection);
      const stillExistsAnywhere = selectableRows.some((row) => Number(row.id || 0) === previousSelection);
      const stillExistsInManaged = managedRows.some((row) => Number(row.id || 0) === previousSelection);
      if (stillExistsInActionable) {
        selectAssignment(previousSelection);
      } else if (pageMode === "work" && previousSubmittedSelection === previousSelection && stillExistsInSubmitted) {
        selectAssignment(previousSelection, { submittedView: true });
      } else if (pageMode === "work" && previousTrackOnlySelection === previousSelection && stillExistsInManaged) {
        selectAssignment(previousSelection, { trackOnly: true });
      } else if (pageMode === "work") {
        if (stillExistsInSubmitted) {
          selectAssignment(previousSelection, { submittedView: true });
        } else if (rows.length > 0) {
          selectAssignment(rows[0]?.id);
        } else if (submittedRows.length > 0) {
          selectAssignment(submittedRows[0]?.id, { submittedView: true });
        } else {
          selectAssignment(null);
        }
      } else if (stillExistsAnywhere) {
        selectAssignment(previousSelection);
      } else {
        if (rows.length > 0) {
          selectAssignment(rows[0]?.id);
        } else if (submittedRows.length > 0) {
          selectAssignment(submittedRows[0]?.id, { submittedView: true });
        } else {
          selectAssignment(managedRows[0]?.id);
        }
      }
    } else {
      if (rows.length > 0) {
        selectAssignment(rows[0]?.id);
      } else if (submittedRows.length > 0) {
        selectAssignment(submittedRows[0]?.id, { submittedView: true });
      } else {
        selectAssignment(managedRows[0]?.id);
      }
    }

    if (showStatus) {
      const totalManaged = canSeeManagedAssignmentsTable() && pageMode === "work" ? ` | งานที่ดูแล ${managedRows.length}` : "";
      const totalSubmitted = pageMode === "work" ? ` | งานที่ส่งแล้ว ${submittedRows.length}` : "";
      setStatus("assignment-status", `โหลดรายการงานสำเร็จ ${rows.length} รายการ${totalSubmitted}${totalManaged}`);
    }
    return rows;
  } catch (err) {
    if (showStatus) {
      setStatus("assignment-status", err.message, true);
    }
    throw err;
  }
}

async function loadAssignmentsByItem(itemId, { showStatus = true, preserveSelection = true } = {}) {
  const targetItemId = parsePositiveInt(itemId, 0);
  if (!targetItemId) return [];
  state.assignments.contextItemId = targetItemId;
  await loadAssignmentContextFieldPackStatus(targetItemId);
  setAssignmentRoleVisibility();

  const response = await api(`/api/items/${targetItemId}/assignments`);
  const rows = Array.isArray(response?.assignments) ? response.assignments : [];
  const previousSelection = Number(state.assignments.selectedId || 0);
  const landingAssignmentId = getAssignmentLandingAssignmentId();
  state.assignments.rows = rows;
  state.assignments.managedRows = [];
  state.assignments.submittedRows = [];
  renderManagedAssignmentsTable([]);
  renderAssignmentsTable(rows);
  renderSubmittedAssignmentsTable([]);

  if (!rows.length) {
    state.assignments.selectedId = null;
    state.assignments.trackOnlySelectionId = null;
    state.assignments.submittedSelectionId = null;
    state.assignments.deliverablesBundle = null;
    state.assignments.assets = [];
    state.assignments.assetLookup = [];
    resetAssignmentExpectedDeliverablesTouched();
    setAssignmentDetailVisible(getAssignmentPageMode() === "handoff");
    setAssignmentProcessGuide(null);
    renderAssignmentContextBrief(null);
    renderAssignmentDeliverablesSummary(null, null);
    renderAssignmentDeliverableAssetOptions();
    renderAssignmentDeliverableAssetPreview();
    renderAssignmentSubmissionForm(null);
    setJsonPreview("assignment-selected-json", null);
    const summaryNode = qs("assignment-selected-summary");
    if (summaryNode) {
      const item = getAssignmentContextItem();
      summaryNode.textContent = item
        ? `กำลังเตรียมส่งงานสำหรับ item #${targetItemId} · ${String(item.title || "").trim() || "-"}`
        : `ยังไม่มีงานของ item #${targetItemId} ในกระบวนการนี้`;
    }
    syncAssignmentWorkflowLayout(null);
    if (showStatus) {
      setStatus("assignment-status", `โหลดงานของ item #${targetItemId} แล้ว แต่ยังไม่มีรายการในกระบวนการนี้`);
    }
    return rows;
  }

  if (landingAssignmentId && rows.some((row) => Number(row.id || 0) === landingAssignmentId)) {
    selectAssignment(landingAssignmentId);
  } else if (preserveSelection && previousSelection && rows.some((row) => Number(row.id || 0) === previousSelection)) {
    selectAssignment(previousSelection);
  } else {
    selectAssignment(rows[0]?.id || 0);
  }

  if (showStatus) {
    setStatus("assignment-status", `โหลดงานของ item #${targetItemId} แล้ว ${rows.length} รายการ`);
  }
  return rows;
}

async function loadAssignmentByLandingId(assignmentId, { showStatus = true } = {}) {
  const targetAssignmentId = parsePositiveInt(assignmentId, 0);
  if (!targetAssignmentId) return null;
  const response = await api(`/api/assignments/${targetAssignmentId}`);
  const assignment = response?.assignment || null;
  if (!assignment) {
    throw new Error("assignment not found");
  }
  const targetItemId = parsePositiveInt(assignment.content_item_id, 0);
  state.assignments.contextItemId = targetItemId;
  await loadAssignmentContextFieldPackStatus(targetItemId);
  setAssignmentRoleVisibility();
  state.assignments.rows = [assignment];
  state.assignments.managedRows = [];
  renderManagedAssignmentsTable([]);
  renderAssignmentsTable(state.assignments.rows);
  selectAssignment(targetAssignmentId);
  if (showStatus) {
    setStatus("assignment-status", `โหลดงาน #${targetAssignmentId} แล้ว`);
  }
  return assignment;
}

function ensureSelectedAssignmentId() {
  const id = Number(state.assignments.selectedId || 0);
  if (!id) {
    throw new Error("กรุณาเลือกงานก่อน");
  }
  return id;
}

async function loadAssignmentSubmissions() {
  if (isEditorUser()) {
    throw new Error("editor cannot load assignment submissions from this surface");
  }
  const assignmentId = ensureSelectedAssignmentId();
  const result = await api(`/api/assignments/${assignmentId}/submissions`);
  const submissions = Array.isArray(result?.submissions) ? result.submissions : [];
  const assignment = getAssignmentById(assignmentId);
  const latestSubmissionId = Number(assignment?.latest_submission_id || 0) || 0;
  const latestSubmission = latestSubmissionId > 0
    ? submissions.find((row) => Number(row?.id || 0) === latestSubmissionId) || submissions[0] || null
    : submissions[0] || null;
  state.assignments.latestSubmissionRows[assignmentId] = latestSubmission || null;
  state.assignments.latestSubmissionArticlePayloads[assignmentId] = latestSubmission?.article_payload_json || null;
  state.assignments.latestSubmissionLoaded[assignmentId] = true;
  setJsonPreview("assignment-submissions-json", result);
  renderAssignmentReviewSummary(assignment);
  renderAssignmentReviewSubmissionContent(assignment);
  setStatus("assignment-status", `โหลดรายการรอบส่งงานของงาน #${assignmentId} แล้ว`);
}

async function loadAssignmentDeliverablesBundle({ showStatus = true } = {}) {
  if (isEditorUser()) {
    throw new Error("editor cannot load assignment deliverables from this surface");
  }
  const assignmentId = ensureSelectedAssignmentId();
  const result = await api(`/api/assignments/${assignmentId}/deliverables/latest-bundle`);
  if (Number(state.assignments.selectedId || 0) !== assignmentId) {
    return result?.bundle || null;
  }
  state.assignments.deliverablesBundle = result?.bundle || null;
  renderAssignmentDeliverablesSummary(state.assignments.deliverablesBundle, getAssignmentById(assignmentId));
  renderAssignmentReviewSummary(getAssignmentById(assignmentId));
  renderAssignmentReviewSubmissionContent(getAssignmentById(assignmentId));
  if (showStatus) {
    const bundle = state.assignments.deliverablesBundle;
    const missingCount = Number(bundle?.missing_deliverable_types?.length || 0);
    setStatus("assignment-status", `โหลดข้อมูลงานส่งของงาน #${assignmentId} แล้ว${missingCount > 0 ? ` | ยังขาด ${missingCount} ประเภท` : ""}`);
  }
  return state.assignments.deliverablesBundle;
}

async function loadAssignmentAssets({ showStatus = false } = {}) {
  const assignmentId = ensureSelectedAssignmentId();
  const assignment = getAssignmentById(assignmentId);
  const contentItemId = Number(assignment?.content_item_id || 0) || 0;
  if (!contentItemId) {
    state.assignments.assets = [];
    state.assignments.assetLookup = [];
    renderAssignmentDeliverableAssetOptions();
    renderAssignmentDeliverableAssetPreview();
    return [];
  }
  const rows = await api(`/api/assets?content_item_id=${contentItemId}`);
  if (Number(state.assignments.selectedId || 0) !== assignmentId) {
    return Array.isArray(rows) ? rows : [];
  }
  state.assignments.assetLookup = Array.isArray(rows) ? rows : [];
  state.assignments.assets = state.assignments.assetLookup.filter((row) => Number(row.selected_in_clean || 0) === 1 && String(row.role || "") !== "unused");
  const formConfig = getAssignmentSubmissionFormConfig(assignment, state.assignments.contextFieldPack);
  const localQueue = buildAssignmentCaptureFileUploadQueue(assignmentId, formConfig.captureItems);
  if (!localQueue.length) {
    const serverSynced = applyAssignmentServerSyncedAssets(assignmentId, formConfig.captureItems, { showStatus: false });
    if (!serverSynced.complete && Number(serverSynced?.expired_count || 0) > 0 && Number(serverSynced?.assets?.length || 0) === 0) {
      setStatus("assignment-status", "ไฟล์ที่ซิงก์ไว้หมดอายุแล้ว กรุณาอัปโหลด/ซิงก์ไฟล์ใหม่อีกครั้ง", true);
    }
  }
  renderAssignmentDeliverableAssetOptions();
  renderAssignmentDeliverableAssetPreview();
  renderAssignmentDeliverablesSummary(state.assignments.deliverablesBundle, getAssignmentById(assignmentId));
  renderAssignmentReviewSummary(getAssignmentById(assignmentId));
  renderAssignmentReviewSubmissionContent(getAssignmentById(assignmentId));
  if (showStatus) {
    setStatus("assignment-status", `โหลด asset ของ item #${contentItemId} แล้ว ${state.assignments.assets.length} รายการ`);
  }
  return state.assignments.assets;
}

async function loadAssignmentHistory() {
  if (isAssignmentWorkOnlyUser()) {
    throw new Error("role นี้ไม่สามารถดูประวัติการเปลี่ยนแปลงจากหน้านี้");
  }
  if (isEditorUser()) {
    throw new Error("editor cannot load assignment history from this surface");
  }
  const assignmentId = ensureSelectedAssignmentId();
  const result = await api(`/api/assignments/${assignmentId}/history?limit=100`);
  setJsonPreview("assignment-history-json", result);
  setStatus("assignment-status", `โหลดประวัติการเปลี่ยนแปลงของงาน #${assignmentId} แล้ว`);
}

async function updateAssignmentState() {
  if (!canPatchAssignmentState()) {
    throw new Error("role นี้ไม่มีสิทธิ์เปลี่ยนสถานะงานนี้");
  }
  const assignmentId = ensureSelectedAssignmentId();
  const selected = String(qs("assignment-state-action")?.value || "").trim().toLowerCase();
  if (!selected) {
    throw new Error("กรุณาเลือก action หรือ state");
  }

  const body = {};
  if (ASSIGNMENT_ACTION_VALUES.has(selected)) {
    body.action = selected;
  } else {
    body.state = selected;
  }

  const reasonCode = String(qs("assignment-state-reason")?.value || "").trim().toLowerCase();
  if (reasonCode) body.reason_code = reasonCode;
  const contributorNote = String(qs("assignment-state-contributor-note")?.value || "").trim();
  if (contributorNote) body.contributor_note = contributorNote;
  const internalNote = String(qs("assignment-state-internal-note")?.value || "").trim();
  if (internalNote) body.internal_note = internalNote;

  const result = await api(`/api/assignments/${assignmentId}/state`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

  setStatus("assignment-status", `อัปเดตงาน #${assignmentId} เป็น ${result?.assignment?.state || "-"}`);
  await refreshAssignments({ showStatus: false, preserveSelection: true });
  setJsonPreview("assignment-selected-json", result?.assignment || getAssignmentById(assignmentId));
}

function buildAssignmentCaptureFileUploadQueue(assignmentId, capturePrompts = []) {
  const normalizedItems = normalizeAssignmentCaptureUploadItems(capturePrompts);
  const queue = [];
  normalizedItems.forEach((item) => {
    const slug = String(item?.uploadKey || "").trim();
    const mediaType = String(item?.mediaType || "").trim().toLowerCase();
    const files = listAssignmentCaptureFiles(assignmentId, slug).filter((file) => {
      const mimeType = String(file?.type || "").trim().toLowerCase();
      if (mediaType === "image") return mimeType.startsWith("image/");
      if (mediaType === "video") return mimeType.startsWith("video/");
      return false;
    });
    files.forEach((file) => queue.push({
      slug,
      uploadKey: slug,
      slotKey: String(item?.slotKey || slug).trim() || slug,
      prompt: String(item?.prompt || "").trim(),
      mediaType,
      captureType: String(item?.captureType || "").trim().toLowerCase() || "",
      displayIndex: Number(item?.displayIndex || 0) || 0,
      file,
    }));
  });
  return queue;
}

const ASSIGNMENT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024 * 1024;

function assertAssignmentCaptureUploadsComplete(assignmentId, capturePrompts = []) {
  const normalizedItems = normalizeAssignmentCaptureUploadItems(capturePrompts);
  if (!normalizedItems.length) return;
  const assignment = getAssignmentById(assignmentId);
  const requireImages = Boolean(assignment?.image_reset_required);
  const requireVideos = Boolean(assignment?.video_reset_required);
  if (!requireImages && !requireVideos) return;
  const missing = [];
  const invalid = [];
  normalizedItems.forEach((item) => {
    const slug = String(item?.uploadKey || "").trim();
    const files = listAssignmentCaptureFiles(assignmentId, slug);
    const images = files.filter((file) => String(file?.type || "").trim().toLowerCase().startsWith("image/"));
    const videos = files.filter((file) => String(file?.type || "").trim().toLowerCase().startsWith("video/"));
    if (item.mediaType === "image" && requireImages) {
      if (images.length < 1) missing.push(`รูปหัวข้อ ${item.displayIndex}: ${item.prompt}`);
      if (images.length > 5) invalid.push(`รูปหัวข้อ ${item.displayIndex}: เกิน 5 ไฟล์`);
    }
    if (item.mediaType === "video" && requireVideos) {
      if (videos.length < 1) missing.push(`วิดีโอหัวข้อ ${item.displayIndex}: ${item.prompt}`);
      if (videos.length > 2) invalid.push(`วิดีโอหัวข้อ ${item.displayIndex}: เกิน 2 ไฟล์`);
      const oversized = videos.find((file) => Number(file?.size || 0) > ASSIGNMENT_UPLOAD_MAX_BYTES);
      if (oversized) invalid.push(`วิดีโอหัวข้อ ${item.displayIndex}: ไฟล์ ${sanitizeUploadFileName(oversized.name, "video")} เกิน 20GB`);
    }
  });
  if (invalid.length) {
    throw new Error(invalid.join(" | "));
  }
  if (missing.length) {
    throw new Error(`ยังแนบไฟล์ไม่ครบตามเงื่อนไข reset: ${missing.join(" | ")}`);
  }
}

async function uploadAssignmentSubmissionFiles(assignmentId, fileQueue = [], options = {}) {
  const CHUNK_THRESHOLD_BYTES = 20 * 1024 * 1024;
  const CHUNK_SIZE_BYTES = 20 * 1024 * 1024;
  const queue = Array.isArray(fileQueue) ? fileQueue : [];
  const validQueue = queue
    .map((entry) => {
      const original = entry?.file instanceof File ? entry.file : null;
      if (!original) return null;

      const slug = String(entry?.slug || "misc").trim() || "misc";
      const renamed = `${slug}__${sanitizeUploadFileName(original.name, "upload")}`;

      return {
        original,
        renamed,
        slug,
        prompt: entry?.prompt || "",
      };
    })
    .filter(Boolean);
  if (!validQueue.length) return [];

  const syncBatchId = String(options?.syncBatchId || "").trim();
  if (!syncBatchId) {
    throw new Error("ไม่พบ sync batch id สำหรับการอัปโหลดรอบนี้");
  }

  async function uploadAssignmentFileInChunks(entry, index) {
    const totalChunks = Math.max(1, Math.ceil(Number(entry.original.size || 0) / CHUNK_SIZE_BYTES));
    const startResult = await api(`/api/assignments/${assignmentId}/assets/uploads/start`, {
      method: "POST",
      body: JSON.stringify({
        file_name: entry.renamed,
        mime_type: String(entry.original.type || "").trim().toLowerCase(),
        size_bytes: Number(entry.original.size || 0) || 0,
        total_chunks: totalChunks,
        chunk_size_bytes: CHUNK_SIZE_BYTES,
        sync_batch_id: syncBatchId,
        slot_key: String(entry?.slotKey || entry?.slug || "").trim().toLowerCase() || null,
        media_type: String(entry?.mediaType || "").trim().toLowerCase() || null,
      }),
    });
    const uploadId = String(startResult?.upload_id || "").trim();
    if (!uploadId) {
      throw new Error("ระบบไม่ส่ง upload_id กลับมา");
    }

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * CHUNK_SIZE_BYTES;
      const end = Math.min(start + CHUNK_SIZE_BYTES, entry.original.size);
      const blob = entry.original.slice(start, end);
      const form = new FormData();
      form.append("chunk", blob, `${entry.renamed}.part-${chunkIndex + 1}`);
      form.append("chunk_index", String(chunkIndex));
      setStatus(
        "assignment-status",
        `กำลังอัปโหลดไฟล์ ${index + 1}/${validQueue.length}: ${entry.original.name} (chunk ${chunkIndex + 1}/${totalChunks})`
      );
      await api(`/api/assignments/${assignmentId}/assets/uploads/${uploadId}/chunks`, {
        method: "POST",
        body: form,
      });
    }

    return api(`/api/assignments/${assignmentId}/assets/uploads/${uploadId}/finalize`, {
      method: "POST",
      body: JSON.stringify({ sync_batch_id: syncBatchId }),
    });
  }

  const uploaded = [];
  for (const [index, entry] of validQueue.entries()) {
    let result;
    try {
      const mimeType = String(entry.original?.type || "").trim().toLowerCase();
      const shouldUseChunkUpload = mimeType.startsWith("video/") || Number(entry.original.size || 0) > CHUNK_THRESHOLD_BYTES;
      if (shouldUseChunkUpload) {
        result = await uploadAssignmentFileInChunks(entry, index);
      } else {
        const form = new FormData();
        form.append("file", entry.original, entry.renamed);
        form.append("sync_batch_id", syncBatchId);
        form.append("slot_key", String(entry?.slotKey || entry?.slug || "").trim().toLowerCase() || "");
        form.append("media_type", String(entry?.mediaType || "").trim().toLowerCase() || "");
        result = await api(`/api/assignments/${assignmentId}/assets/upload`, {
          method: "POST",
          body: form,
        });
      }
    } catch (err) {
      const fileName = entry.original?.name || entry.renamed || `file ${index + 1}`;
      const message = err?.message || String(err || "unknown error");
      throw new Error(
        `อัปโหลดไฟล์ที่ ${index + 1}/${validQueue.length} ไม่สำเร็จ: ${fileName} — ${message}`
      );
    }

    const batchUploaded = Array.isArray(result?.uploaded) ? result.uploaded : [];
    uploaded.push(...batchUploaded);
  }

  return uploaded;
}

async function syncAssignmentSubmissionUploads() {
  const assignmentId = ensureSelectedAssignmentId();
  const assignment = getAssignmentById(assignmentId);
  const formConfig = getAssignmentSubmissionFormConfig(assignment, state.assignments.contextFieldPack);
  assertAssignmentCaptureUploadsComplete(assignmentId, formConfig.captureItems);
  const uploadQueue = buildAssignmentCaptureFileUploadQueue(assignmentId, formConfig.captureItems);
  if (uploadQueue.length > 0) {
    const syncKey = getAssignmentCaptureSyncKey(assignmentId, formConfig.captureItems);
    if (isAssignmentCaptureUploadsSynced(assignmentId, formConfig.captureItems)) {
      const cachedAssets = getSyncedUploadAssetsForKey(syncKey);
      if (!cachedAssets.length) {
        throw new Error("พบสถานะซิงก์ไฟล์เดิม แต่ไม่พบรายการไฟล์ที่ซิงก์ในหน้านี้ กรุณากดอัปโหลด/ซิงก์ไฟล์อีกครั้ง");
      }
      setLatestUploadedAssetsForSyncKey(syncKey, cachedAssets);
      const syncedCount = cachedAssets.length;
      renderAssignmentSubmissionFileList();
      renderAssignmentSubmissionGatePanel(buildAssignmentSubmissionGateState(assignmentId, formConfig));
      setStatus("assignment-status", `ไฟล์ชุดนี้ซิงก์แล้ว รอส่งงานกลับ | ซิงก์แล้ว ${syncedCount} ไฟล์`);
      return;
    }
    const syncBatchId = createAssignmentSyncBatchId(assignmentId);
    const uploadedAssets = await uploadAssignmentSubmissionFiles(assignmentId, uploadQueue, { syncBatchId });
    markAssignmentCaptureUploadsSynced(assignmentId, formConfig.captureItems, uploadedAssets);
    renderAssignmentSubmissionFileList();
    renderAssignmentSubmissionGatePanel(buildAssignmentSubmissionGateState(assignmentId, formConfig));
    // TODO: define cleanup policy for synced-but-unsubmitted assignment assets.
    setStatus("assignment-status", `ไฟล์ซิงก์แล้ว รอส่งงานกลับ | ซิงก์แล้ว ${uploadedAssets.length} ไฟล์`);
    return;
  }

  const serverSynced = applyAssignmentServerSyncedAssets(assignmentId, formConfig.captureItems, { showStatus: false });
  if (serverSynced.complete && Array.isArray(serverSynced.assets) && serverSynced.assets.length) {
    renderAssignmentSubmissionFileList();
    renderAssignmentSubmissionGatePanel(buildAssignmentSubmissionGateState(assignmentId, formConfig));
    setStatus("assignment-status", `มีไฟล์ที่ซิงก์แล้วบน server รอส่งงานกลับ | ซิงก์แล้ว ${serverSynced.assets.length} ไฟล์`);
    return;
  }
  if (Number(serverSynced?.expired_count || 0) > 0 && Number(serverSynced?.assets?.length || 0) === 0) {
    throw new Error("ไฟล์ที่ซิงก์ไว้หมดอายุแล้ว กรุณาอัปโหลด/ซิงก์ไฟล์ใหม่อีกครั้ง");
  }
  throw new Error("ยังไม่มีไฟล์ที่เลือกในเครื่อง และไม่พบไฟล์ที่ซิงก์แล้วบน server");
}

function buildAssignmentSubmissionMediaPayload(uploadedAssets = [], captureItems = []) {
  const captureLookup = buildAssignmentCaptureItemLookup(captureItems);
  return {
    assets: (Array.isArray(uploadedAssets) ? uploadedAssets : []).map((asset) => ({
      id: Number(asset?.id || 0) || null,
      file_name: String(asset?.file_name || "").trim() || null,
      mime_type: String(asset?.mime_type || "").trim() || null,
      public_url: String(asset?.public_url || "").trim() || null,
      slotKey: (() => {
        const slotTypeKey = getAssignmentAssetSlotTypeKeyFromAsset(asset);
        return slotTypeKey ? slotTypeKey.split("|")[0] : null;
      })(),
      mediaType: (() => {
        const slotTypeKey = getAssignmentAssetSlotTypeKeyFromAsset(asset);
        return slotTypeKey ? slotTypeKey.split("|")[1] : normalizeAssignmentCaptureMediaType(asset?.assignment_media_type) || null;
      })(),
      capture_type: (() => {
        const slotTypeKey = getAssignmentAssetSlotTypeKeyFromAsset(asset);
        const slotKey = slotTypeKey ? slotTypeKey.split("|")[0] : "";
        return String(captureLookup.get(slotKey)?.captureType || "").trim().toLowerCase() || null;
      })(),
      prompt: (() => {
        const slotTypeKey = getAssignmentAssetSlotTypeKeyFromAsset(asset);
        const slotKey = slotTypeKey ? slotTypeKey.split("|")[0] : "";
        return String(captureLookup.get(slotKey)?.prompt || "").trim() || null;
      })(),
    })),
  };
}

async function createAssignmentSubmissionDeliverablesForUploads(assignmentId, submissionId, uploadedAssets = []) {
  for (const asset of Array.isArray(uploadedAssets) ? uploadedAssets : []) {
    const assetId = Number(asset?.id || 0) || 0;
    if (!assetId) continue;
    const mimeType = String(asset?.mime_type || "").trim().toLowerCase();
    const deliverableType = mimeType.startsWith("video/") ? "videos" : "photos";
    await api(`/api/assignments/${assignmentId}/submissions/${submissionId}/deliverables`, {
      method: "POST",
      body: JSON.stringify({
        deliverable_type: deliverableType,
        status: "submitted",
        source_asset_id: assetId,
        title: String(asset?.file_name || "").trim() || null,
      }),
    });
  }
}

async function createAssignmentSubmission() {
  if (isEditorUser()) {
    throw new Error("editor ส่งงานผ่าน article/event workspace เท่านั้น");
  }
  const assignmentId = ensureSelectedAssignmentId();
  const assignment = getAssignmentById(assignmentId);
  const formConfig = getAssignmentSubmissionFormConfig(assignment, state.assignments.contextFieldPack);
  const assignmentState = String(assignment?.state || "").trim().toLowerCase();
  const action = assignmentState === "revision_requested" ? "resubmit" : "submit";
  const body = { action };
  const articlePayload = buildAssignmentSubmissionArticlePayload();
  const requestedCheckReturnPayload = buildAssignmentRequestedCheckReturnPayloadFromDraft(
    syncAssignmentRequestedCheckReturnDraftFromForm(assignmentId)
  );
  const sourceHandoffSnapshotId = Number(state.assignments.handoffSourceSnapshotIds?.[assignmentId] || 0) || 0;
  if (!sourceHandoffSnapshotId) {
    throw new Error("ไม่พบ handoff snapshot ที่ใช้เปิดฟอร์มนี้ กรุณาโหลด assignment ใหม่ก่อนส่งงาน");
  }
  writeAssignmentSubmissionDraft(assignmentId, articlePayload, assignment);
  body.article_payload_json = articlePayload;
  body.source_handoff_snapshot_id = sourceHandoffSnapshotId;
  if (requestedCheckReturnPayload) {
    body.field_return_payload_json = requestedCheckReturnPayload;
  }

  assertAssignmentCaptureUploadsComplete(assignmentId, formConfig.captureItems);
  const uploadQueue = buildAssignmentCaptureFileUploadQueue(assignmentId, formConfig.captureItems);
  const gateState = buildAssignmentSubmissionGateState(assignmentId, formConfig, {
    articlePayload,
    uploadQueue,
  });
  renderAssignmentSubmissionGatePanel(gateState);
  if (!gateState.canSubmit) {
    focusFirstAssignmentSubmissionGateIssue(gateState);
    throw new Error(String(gateState.blockingReasons[0] || "ยังส่งงานไม่ได้"));
  }
  const composed = gateState.composed || composeAssignmentSubmissionEffectiveAssets(assignmentId, formConfig.captureItems, { uploadQueue, strict: true });
  const syncKey = String(composed?.syncKey || getAssignmentCaptureSyncKey(assignmentId, formConfig.captureItems));
  const uploadedAssets = Array.isArray(composed?.payloadAssets) ? composed.payloadAssets : [];

  if (uploadedAssets.length) {
    body.media_payload_json = buildAssignmentSubmissionMediaPayload(uploadedAssets, formConfig.captureItems);
  }

  const result = await api(`/api/assignments/${assignmentId}/submissions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const submitButton = qs("btn-assignment-submit");
  const syncButton = qs("btn-assignment-sync-upload");
  if (submitButton) submitButton.disabled = true;
  if (syncButton) syncButton.disabled = true;
  const submissionId = Number(result?.submission?.id || 0) || 0;
  if (submissionId > 0 && uploadedAssets.length) {
    await createAssignmentSubmissionDeliverablesForUploads(assignmentId, submissionId, uploadedAssets).catch(() => {});
  }
  clearAssignmentSubmissionDraft(assignmentId);
  await deleteAssignmentSubmissionServerDraft(assignmentId).catch(() => {});
  state.assignments.latestSubmissionArticlePayloads[assignmentId] = articlePayload;
  state.assignments.latestSubmissionLoaded[assignmentId] = true;
  setLatestUploadedAssetsForSyncKey(syncKey, uploadedAssets);
  setStatus(
    "assignment-status",
    uploadedAssets.length
      ? `ส่งรอบงาน #${submissionId || "-"} กลับเข้าระบบสำเร็จ | อัปโหลด ${uploadedAssets.length} ไฟล์แล้ว`
      : `ส่งรอบงาน #${submissionId || "-"} กลับเข้าระบบสำเร็จ`
  );
  await refreshAssignments({ showStatus: false, preserveSelection: true }).catch(() => {});
  if (Number(state.assignments.selectedId || 0) === assignmentId) {
    await loadAssignmentDeliverablesBundle({ showStatus: false }).catch(() => {});
    await loadAssignmentAssets({ showStatus: false }).catch(() => {});
  }
  clearAssignmentCaptureUploads(assignmentId);
  renderAssignmentSubmissionFileList();
  if (canPatchAssignmentState()) {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "review");
    params.set("assignment_id", String(assignmentId));
    params.set("item_id", String(Number(assignment?.content_item_id || state.assignments.contextItemId || 0) || 0));
    const query = params.toString();
    window.location.assign(`${window.location.pathname}${query ? `?${query}` : ""}`);
    return;
  }
}

async function createAssignmentDeliverable() {
  if (isEditorUser()) {
    throw new Error("editor จัดการ deliverables จาก assignment surface ไม่ได้");
  }
  const assignmentId = ensureSelectedAssignmentId();
  const assignment = getAssignmentById(assignmentId);
  const latestSubmissionId = Number(
    state.assignments.deliverablesBundle?.latest_submission_id
    || assignment?.latest_submission_id
    || 0
  ) || 0;
  if (!latestSubmissionId) {
    throw new Error("ต้องมีรอบส่งล่าสุดก่อน จึงจะเพิ่มงานส่งได้");
  }

  const payload = buildAssignmentDeliverablePayloadFromForm();
  const result = await api(`/api/assignments/${assignmentId}/submissions/${latestSubmissionId}/deliverables`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setStatus(
    "assignment-status",
    `เพิ่มงานส่ง ${getAssignmentDeliverableLabel(result?.deliverable?.deliverable_type || payload.deliverable_type)} ให้รอบส่ง #${latestSubmissionId} สำเร็จ`
  );
  await refreshAssignments({ showStatus: false, preserveSelection: true });
  await loadAssignmentSubmissions();
  await loadAssignmentDeliverablesBundle({ showStatus: false });
  await loadAssignmentAssets({ showStatus: false }).catch(() => {});
  const missing = Array.isArray(state.assignments.deliverablesBundle?.missing_deliverable_types)
    ? state.assignments.deliverablesBundle.missing_deliverable_types
    : [];
  const nextType = missing[0] || "";
  if (nextType) {
    const typeNode = qs("assignment-deliverable-type");
    if (typeNode) typeNode.value = nextType;
  }
}

async function createAssignmentForContextItem() {
  if (!canManageFreelanceAssignments()) {
    throw new Error("role นี้ไม่มีสิทธิ์ส่งงานไปทำ");
  }

  const itemId = Number(state.assignments.contextItemId || getAssignmentLandingItemId() || 0) || 0;
  if (!itemId) {
    throw new Error("ยังไม่ได้เลือกรายการที่จะส่งงานไปทำ");
  }
  if (!hasAssignmentBriefPrepared(state.assignments.contextFieldPack)) {
    throw new Error('ยังส่งงานไปทำไม่ได้: ต้องผ่านขั้น "จัด brief" ก่อน');
  }
  if (!isAssignmentContextReady(state.assignments.contextFieldPackStatus)) {
    throw new Error('ยังส่งงานไปทำไม่ได้: ต้องผ่านขั้น "พร้อมส่งเข้า handoff" ก่อน');
  }
  const contextItem = findLoadedItemById(itemId);
  if (!isHandoffEligibleItem(contextItem)) {
    throw new Error("ยังส่งงานไปทำไม่ได้: รายการนี้ยังไม่พร้อมใน Step 4 หรือยังไม่ได้ตั้งสถานะเป็นพร้อมส่งเข้า handoff");
  }

  const assigneeMode = String(qs("assignment-create-assignee-mode")?.value || "internal").trim().toLowerCase();
  const assignmentKind = getAssignmentCreateKind();
  const assigneeId = parsePositiveInt(qs("assignment-create-assignee-id")?.value, 0);
  const externalAssigneeName = String(qs("assignment-create-assignee-name")?.value || "").trim();
  const externalAssigneePhone = String(qs("assignment-create-assignee-phone")?.value || "").trim();
  const externalAssigneeEmail = String(qs("assignment-create-assignee-email")?.value || "").trim().toLowerCase();
  const externalAssigneeLineId = String(qs("assignment-create-assignee-line-id")?.value || "").trim();

  const payload = {};
  payload.assignment_kind = assignmentKind;
  if (assigneeMode === "external") {
    if (!externalAssigneeName || (!externalAssigneePhone && !externalAssigneeEmail && !externalAssigneeLineId)) {
      throw new Error("กรุณากรอกชื่อและข้อมูลติดต่ออย่างน้อย 1 ช่องทางของผู้รับงานภายนอก");
    }
    payload.external_assignee_profile_json = {
      name: externalAssigneeName,
      phone: externalAssigneePhone,
      email: externalAssigneeEmail,
      line_id: externalAssigneeLineId,
    };
    payload.assignee_name = externalAssigneeName;
    payload.assignee_contact = externalAssigneePhone || externalAssigneeEmail || externalAssigneeLineId || "";
  } else {
    if (!assigneeId) {
      throw new Error("กรุณาเลือกผู้รับงาน");
    }
    payload.assignee_user_id = assigneeId;
  }
  const dueAt = normalizeAssignmentCreateDueAt(qs("assignment-create-due-at")?.value);
  if (dueAt) payload.due_at = dueAt;
  const contributorNote = String(qs("assignment-create-note")?.value || "").trim();
  if (contributorNote) payload.contributor_note = contributorNote;

  const result = await api(`/api/items/${itemId}/assignments`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const assignmentId = Number(result?.assignment?.id || 0) || 0;
  if (assignmentId) {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", "work");
    params.set("item_id", String(itemId));
    params.set("assignment_id", String(assignmentId));
    const query = params.toString();
    window.location.assign(`${window.location.pathname}${query ? `?${query}` : ""}`);
    return;
  }
  throw new Error("ระบบไม่ส่ง assignment id กลับมา");
}

async function evaluateAssignmentSubmissionDecision() {
  const assignmentId = ensureSelectedAssignmentId();
  const payload = buildEvaluatePayloadFromForm();
  const result = await api(`/api/assignments/${assignmentId}/submission-decision/evaluate`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setJsonPreview("assignment-evaluate-json", result);

  const matchScope = String(result?.legacy_top_level_match_scope || "-");
  const isMatch = Boolean(result?.legacy_top_level_matches_authoritative);
  const mismatchFields = Array.isArray(result?.legacy_top_level_mismatch_fields)
    ? result.legacy_top_level_mismatch_fields.join(", ")
    : "";
  const mismatchSuffix = isMatch ? "match" : `mismatch [${mismatchFields || "-"}]`;

  setStatus(
    "assignment-status",
    `ตรวจรับงานส่ง (submission-decision) สำเร็จ | scope=${matchScope} | ${mismatchSuffix}`
  );
}

async function refreshAll() {
  if (!state.user) return;

  const itemsPromise = isExternalContributorUser() ? Promise.resolve([]) : api("/api/items");
  const ingestionsPromise = isExternalContributorUser() ? Promise.resolve([]) : api("/api/source-ingestions");
  const usersPromise = canAccessUserManagement() ? api("/api/users") : Promise.resolve({ items: [] });
  const agentProfilesPromise = isOwnerUser() ? api("/api/agent-profiles") : Promise.resolve({ items: [] });
  const aiPoliciesPromise = isOwnerUser() ? api("/api/ai-feature-policies") : Promise.resolve({ items: [], policy_catalog: [] });
  const cleanupItemsPromise = canAccessSystemPage()
    ? api("/api/admin/deleted-items?limit=100")
        .then((response) => ({ ok: true, response }))
        .catch((error) => ({ ok: false, error }))
    : Promise.resolve({ ok: true, response: { items: [] } });

  const requestedTab = getRequestedTabFromUrl();
  const shouldPrioritizeRawRender = requestedTab === "raw" || String(state.preferredTab || "").trim().toLowerCase() === "raw";
  const rawSummaryNode = qs("raw-summary");
  if (shouldPrioritizeRawRender && rawSummaryNode) {
    rawSummaryNode.textContent = "กำลังโหลดรายการเตรียมคอนเทนต์...";
  }

  const [items, ingestions] = await Promise.all([
    itemsPromise.catch(() => []),
    ingestionsPromise.catch(() => []),
  ]);

  state.items = Array.isArray(items) ? items : [];
  renderRawTable(state.items);
  if (state.dashboard.rawMergeOpen) {
    renderRawBulkMergeModal();
    setRawBulkMergeOpen(true);
  }
  renderSourceIngestions(ingestions);

  const [usersResponse, agentProfilesResponse, aiPoliciesResponse, cleanupResult] = await Promise.all([
    usersPromise.catch(() => ({ items: [] })),
    agentProfilesPromise.catch(() => ({ items: [] })),
    aiPoliciesPromise.catch((error) => ({ items: [], policy_catalog: [], _error: error?.message || "โหลด AI policy ไม่สำเร็จ" })),
    cleanupItemsPromise,
  ]);

  state.visibleUsers = Array.isArray(usersResponse?.items) ? usersResponse.items : [];
  state.freelanceUsers = (usersResponse?.items || []).filter((row) => String(row?.role || "").toLowerCase() === "freelance");
  state.agentProfiles = Array.isArray(agentProfilesResponse?.items) ? agentProfilesResponse.items : [];
  state.aiPolicyRows = Array.isArray(aiPoliciesResponse?.items) ? aiPoliciesResponse.items : [];
  state.aiPolicyCatalog = Array.isArray(aiPoliciesResponse?.policy_catalog) ? aiPoliciesResponse.policy_catalog : [];
  state.aiPolicyLoaded = !String(aiPoliciesResponse?._error || "").trim();
  state.aiPolicyError = String(aiPoliciesResponse?._error || "").trim();
  applyCleanupRowsResponse(
    cleanupResult?.ok === false ? { items: [] } : cleanupResult?.response,
    cleanupResult?.ok === false ? cleanupResult?.error?.message || "โหลดรายการ cleanup ไม่สำเร็จ" : ""
  );
  state.referenceCleanupDeletedItems = Array.isArray(state.cleanup?.rows) ? state.cleanup.rows : [];
  if (!state.referenceCleanupDeletedItems.some((row) => (Number(row?.id || 0) || 0) === Number(state.referenceCleanupSelectedItemId || 0))) {
    state.referenceCleanupSelectedItemId = Number(state.referenceCleanupDeletedItems[0]?.id || 0) || 0;
    state.referenceCleanupReferences = null;
    state.referenceCleanupSelectedGroups = new Set();
  }
  updateUserManagementUI();
  renderAgentProfilePanel();
  renderAiPolicyPanel();
  renderDataCleanupPanel();
  renderReferenceCleanupPanel();
  renderUsersTable(usersResponse?.items || []);
  renderAssignmentAssigneeOptions();
  renderManagedAssignmentsTable(state.assignments.managedRows);
  renderAssignmentsTable(state.assignments.rows);
  const assignmentPageMode = getAssignmentPageMode();
  if (!getAssignmentLandingItemId()) {
    state.assignments.contextItemId = 0;
    setAssignmentRoleVisibility();
  }

  const landingItemId = getAssignmentLandingItemId();
  if (assignmentPageMode === "handoff" && !isAssignmentWorkOnlyUser() && landingItemId && !state.assignments.itemLandingApplied) {
    state.assignments.itemLandingApplied = true;
    await loadAssignmentsByItem(landingItemId, { showStatus: false, preserveSelection: true }).catch((err) => {
      state.assignments.itemLandingApplied = false;
      setStatus("assignment-status", err.message, true);
    });
    return;
  }

  const landingAssignmentId = getAssignmentLandingAssignmentId();
  if (assignmentPageMode !== "work" && assignmentPageMode !== "review" && landingAssignmentId && !landingItemId && !state.assignments.assignmentLandingApplied) {
    state.assignments.assignmentLandingApplied = true;
    await loadAssignmentByLandingId(landingAssignmentId, { showStatus: false }).catch((err) => {
      state.assignments.assignmentLandingApplied = false;
      setStatus("assignment-status", err.message, true);
    });
    return;
  }

  const assigneeSelected = parsePositiveInt(qs("assignment-assignee-id")?.value, 0);
  if (assignmentPageMode === "work" || assignmentPageMode === "review" || assigneeSelected) {
    await refreshAssignments({ showStatus: false, preserveSelection: true }).catch(() => {
      state.assignments.rows = [];
      state.assignments.managedRows = [];
      state.assignments.submittedRows = [];
      state.assignments.selectedId = null;
      state.assignments.trackOnlySelectionId = null;
      state.assignments.submittedSelectionId = null;
      renderManagedAssignmentsTable([]);
      renderAssignmentsTable([]);
      renderSubmittedAssignmentsTable([]);
      setAssignmentDetailVisible(false);
      setAssignmentProcessGuide(null);
    });
    return;
  }

  state.assignments.rows = [];
  state.assignments.managedRows = [];
  state.assignments.submittedRows = [];
  state.assignments.selectedId = null;
  state.assignments.trackOnlySelectionId = null;
  state.assignments.submittedSelectionId = null;
  state.assignments.deliverablesBundle = null;
  state.assignments.assets = [];
  state.assignments.assetLookup = [];
  resetAssignmentExpectedDeliverablesTouched();
  renderManagedAssignmentsTable([]);
  renderAssignmentsTable([]);
  renderSubmittedAssignmentsTable([]);
  setAssignmentDetailVisible(false);
  setAssignmentProcessGuide(null);
  renderAssignmentDeliverablesSummary(null, null);
  renderAssignmentReviewSummary(null);
  renderAssignmentReviewSubmissionContent(null);
  renderAssignmentDeliverableAssetOptions();
  renderAssignmentDeliverableAssetPreview();
  renderAssignmentSubmissionForm(null);
  const summaryNode = qs("assignment-selected-summary");
  if (summaryNode) {
    renderAssignmentAssigneeSelectionSummary();
  }
  setJsonPreview("assignment-selected-json", null);
}

async function refreshAssignmentWorkspaceForCurrentMode({ showStatus = false } = {}) {
  const pageMode = getAssignmentPageMode();
  const landingItemId = getAssignmentLandingItemId();
  if (pageMode === "handoff") {
    if (!isAssignmentWorkOnlyUser() && landingItemId) {
      await loadAssignmentsByItem(landingItemId, { showStatus, preserveSelection: true });
      return;
    }
    renderAssignmentsTable(state.assignments.rows);
    setAssignmentRoleVisibility();
    return;
  }
  if (pageMode !== "work" && landingItemId && !isAssignmentWorkOnlyUser()) {
    await loadAssignmentsByItem(landingItemId, { showStatus, preserveSelection: true });
    return;
  }
  await refreshAssignments({ showStatus, preserveSelection: true });
}

function wireTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));

  tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      const navMode = String(tab.dataset.nav || "").trim().toLowerCase();
      const navHref = String(tab.dataset.href || "").trim();
      if (navMode === "page" && navHref) {
        window.location.href = navHref;
        return;
      }
      const rawTabValue = String(tab.dataset.tab || "").trim().toLowerCase();
      applyLandingState({
        requestedTab: rawTabValue,
        fallbackTab: state.preferredTab,
        syncUrl: true,
        refreshAssignments: true,
        reason: "tab-click",
      });
    });
  });

  document.querySelectorAll("[data-assignment-tab]").forEach((node) => {
    node.addEventListener("click", async () => {
      const nextMode = String(node.getAttribute("data-assignment-tab") || "").trim().toLowerCase();
      if (!nextMode) return;
      applyLandingState({
        requestedTab: nextMode,
        fallbackTab: state.preferredTab,
        syncUrl: true,
        refreshAssignments: true,
        reason: "assignment-subtab-click",
      });
    });
  });
}

function goToProcessTab(tabId) {
  if (tabId === "tab-handoff") {
    applyLandingState({ requestedTab: "handoff", fallbackTab: state.preferredTab, syncUrl: true, refreshAssignments: true, reason: "goToProcessTab-handoff" });
    return;
  }
  if (tabId === "tab-work") {
    applyLandingState({ requestedTab: "work", fallbackTab: state.preferredTab, syncUrl: true, refreshAssignments: true, reason: "goToProcessTab-work" });
    return;
  }
  if (tabId === "tab-review") {
    applyLandingState({ requestedTab: "review", fallbackTab: state.preferredTab, syncUrl: true, refreshAssignments: true, reason: "goToProcessTab-review" });
    return;
  }
  const tabNode = qs(tabId);
  const requestedTab = String(tabNode?.dataset?.tab || "").trim().toLowerCase();
  if (!requestedTab) return;
  applyLandingState({ requestedTab, fallbackTab: state.preferredTab, syncUrl: true, refreshAssignments: true, reason: "goToProcessTab-generic" });
}

function wireProcessTransitions() {
  qs("btn-home-place")?.addEventListener("click", () => {
    window.location.href = "/place.html";
  });
  qs("btn-home-events")?.addEventListener("click", () => {
    window.location.href = "/events.html";
  });
  qs("btn-home-transport")?.addEventListener("click", () => {
    window.location.href = "/transport.html";
  });
  qs("btn-home-users")?.addEventListener("click", () => {
    applyLandingState({ requestedTab: "users", fallbackTab: state.preferredTab, syncUrl: true, refreshAssignments: false, reason: "btn-home-users" });
  });
  qs("btn-users-home")?.addEventListener("click", () => {
    applyLandingState({ requestedTab: "home", fallbackTab: state.preferredTab, syncUrl: true, refreshAssignments: false, reason: "btn-users-home" });
  });
  qs("btn-open-place-raw")?.addEventListener("click", () => {
    applyLandingState({ requestedTab: "raw", fallbackTab: state.preferredTab, syncUrl: true, refreshAssignments: false, reason: "btn-open-place-raw" });
  });
  qs("btn-open-place-assignments")?.addEventListener("click", () => {
    applyLandingState({ requestedTab: "handoff", fallbackTab: state.preferredTab, syncUrl: true, refreshAssignments: true, reason: "btn-open-place-assignments" });
  });
  qs("btn-raw-home")?.addEventListener("click", () => {
    applyLandingState({ requestedTab: "home", fallbackTab: state.preferredTab, syncUrl: true, refreshAssignments: false, reason: "btn-raw-home" });
  });
  qs("btn-assignments-home")?.addEventListener("click", () => {
    applyLandingState({ requestedTab: "home", fallbackTab: state.preferredTab, syncUrl: true, refreshAssignments: false, reason: "btn-assignments-home" });
  });
  qs("btn-raw-process-home")?.addEventListener("click", () => {
    window.location.href = "/place.html";
  });
  qs("btn-go-assignments")?.addEventListener("click", () => {
    goToProcessTab("tab-handoff");
  });

    qs("btn-open-events-manager")?.addEventListener("click", () => {
      window.location.href = "/events-manager.html";
    });
  qs("btn-open-transport-map-manager")?.addEventListener("click", () => {
    window.location.href = "/transport-map-routes.html";
  });
  qs("btn-open-other-transport-manager")?.addEventListener("click", () => {
    window.location.href = "/other-transport.html";
  });
}

function wireAuth() {
  qs("btn-login")?.addEventListener("click", async () => {
    try {
      const email = qs("auth-email")?.value.trim();
      const password = qs("auth-password")?.value || "";
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      state.token = result.token;
      sessionStorage.setItem("collector_token", state.token);
      localStorage.setItem("collector_token", state.token);
      state.loginAt = new Date().toISOString();
      sessionStorage.setItem("collector_login_at", state.loginAt);
      localStorage.setItem("collector_login_at", state.loginAt);
      state.user = result.user;
      const returnTo = consumeAuthReturnTo();
      const normalizedReturnTo = normalizeRoleReturnTo(currentRole(), returnTo);
      const effectiveReturnTo = getRequestedTabFromUrl() && !hasExplicitReturnToQuery() ? "" : normalizedReturnTo;
      const requestedTab = getRequestedTabFromUrl();
      const preferredSeed = requestedTab || state.preferredTab || getDefaultLandingTabForRole(currentRole());
      const resolvedLanding = resolveRequestedLandingState({ requestedTab: preferredSeed, fallbackTab: preferredSeed });
      state.preferredTab = resolvedLanding.resolvedPreferredTab;
      updateAuthUI();
      if (effectiveReturnTo && effectiveReturnTo !== getCurrentReturnToPath()) {
        window.location.assign(effectiveReturnTo);
        return;
      }
      const portalTarget = rolePortalTarget(currentRole(), parsePositiveInt(new URLSearchParams(window.location.search).get("item_id"), 0), parsePositiveInt(new URLSearchParams(window.location.search).get("assignment_id"), 0));
      if (portalTarget && String(window.location.pathname || "/") === "/" && !requestedTab) {
        window.location.assign(portalTarget);
        return;
      }
      await refreshAll();
      if (await maybeApplyEditorLanding(effectiveReturnTo)) {
        return;
      }
      applyLandingState({
        requestedTab: getRequestedTabFromUrl() || state.preferredTab,
        fallbackTab: state.preferredTab,
        syncUrl: true,
        refreshAssignments: true,
        reason: "login-complete",
      });
    } catch (err) {
      setStatus("auth-status", err.message, true);
    }
  });

  qs("btn-logout")?.addEventListener("click", async () => {
    try {
      if (state.token) {
        await api("/api/auth/logout", { method: "POST" });
      }
    } catch {
      // ignore
    }
    applyLogoutUI();
  });
}

function wireRawTableControls() {
  qs("btn-show-all-raw")?.addEventListener("click", () => {
    state.dashboard.rawShowAll = !state.dashboard.rawShowAll;
    refreshAll().catch((err) => setStatus("source-status", err.message, true));
  });

  qs("raw-table-wrap")?.addEventListener("click", (event) => {
    const intakeBtn = event.target.closest("button[data-intake-filter]");
    if (intakeBtn) {
      const nextFilter = String(intakeBtn.dataset.intakeFilter || "all").trim().toLowerCase() || "all";
      if (state.dashboard.rawIntakeFilter !== nextFilter) {
        state.dashboard.rawIntakeFilter = nextFilter;
        renderRawTable(state.items);
      }
      return;
    }
    const reviewBtn = event.target.closest("button[data-review-filter]");
    if (reviewBtn) {
      const nextFilter = String(reviewBtn.dataset.reviewFilter || "all").trim().toLowerCase() || "all";
      if (state.dashboard.rawReviewFilter !== nextFilter) {
        state.dashboard.rawReviewFilter = nextFilter;
        renderRawTable(state.items);
      }
    }
  });

  qs("raw-sort")?.addEventListener("change", (event) => {
    state.dashboard.rawSort = String(event.target?.value || "interestingness").trim() || "interestingness";
    renderRawTable(state.items);
  });

  qs("btn-toggle-raw-table")?.addEventListener("click", () => {
    state.dashboard.rawTableCollapsed = !state.dashboard.rawTableCollapsed;
    const wrap = qs("raw-table-wrap");
    const btn = qs("btn-toggle-raw-table");
    if (wrap) wrap.classList.toggle("hidden", state.dashboard.rawTableCollapsed);
    if (btn) btn.textContent = state.dashboard.rawTableCollapsed ? "แสดงตารางรายการ" : "ซ่อนตารางรายการ";
  });
}

function wireRawBulkActions() {
  qs("btn-raw-bulk-clear")?.addEventListener("click", () => {
    getRawSelectedIds().clear();
    if (qs("raw-bulk-category")) qs("raw-bulk-category").value = "";
    renderRawTable(state.items);
  });

  qs("raw-bulk-category")?.addEventListener("change", () => {
    renderRawBulkToolbar(state.items);
  });

  qs("btn-raw-bulk-category")?.addEventListener("click", async () => {
    try {
      const selected = getSelectedRawItems();
      if (!selected.length) {
        setStatus("source-status", "ยังไม่ได้เลือกรายการที่จะเปลี่ยนหมวดหมู่", true);
        return;
      }
      const category = String(qs("raw-bulk-category")?.value || "").trim();
      if (!category) {
        setStatus("source-status", "กรุณาเลือกหมวดหมู่ใหม่ก่อน", true);
        return;
      }

      const ids = selected.map((item) => Number(item?.id || 0)).filter(Boolean);
      const categoryLabel = toCategoryLabel(category);
      if (!window.confirm(`เปลี่ยนหมวดหมู่ของ ${ids.length} รายการเป็น "${categoryLabel}" ใช่หรือไม่?`)) return;
      const result = await api("/api/items/bulk-category", {
        method: "POST",
        body: JSON.stringify({ ids, category }),
      });
      if (qs("raw-bulk-category")) qs("raw-bulk-category").value = "";
      setStatus("source-status", `เปลี่ยนหมวดหมู่แล้ว ${Number(result?.updated_count || 0)} รายการ เป็น ${categoryLabel}`);
      await refreshAll();
    } catch (err) {
      setStatus("source-status", err.message, true);
    }
  });

  qs("btn-raw-bulk-merge")?.addEventListener("click", () => {
    openRawBulkMergeModal();
  });

  qs("btn-raw-bulk-delete")?.addEventListener("click", async () => {
    try {
      const selected = getSelectedRawItems();
      if (!selected.length) {
        setStatus("source-status", "ยังไม่ได้เลือกรายการที่จะลบ", true);
        return;
      }

      const ids = selected.map((item) => Number(item?.id || 0)).filter(Boolean);
      if (!window.confirm(`ลบรายการที่เลือก ${ids.length} รายการ ใช่หรือไม่?`)) return;
      const result = await api("/api/items/bulk-delete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      getRawSelectedIds().clear();
      setStatus("source-status", `ลบรายการแล้ว ${Number(result?.deleted_count || 0)} รายการ`);
      await refreshAll();
    } catch (err) {
      setStatus("source-status", err.message, true);
    }
  });

  qs("btn-raw-bulk-merge-close")?.addEventListener("click", () => {
    closeRawBulkMergeModal();
  });

  qs("btn-raw-bulk-merge-confirm")?.addEventListener("click", async () => {
    try {
      const selected = getSelectedRawItems();
      if (selected.length < 2) {
        setStatus("raw-bulk-merge-status", "ต้องเลือกอย่างน้อย 2 รายการก่อน merge", true);
        return;
      }
      const masterId = Number(state.dashboard.rawMergeMasterId || 0);
      if (!masterId) {
        setStatus("raw-bulk-merge-status", "กรุณาเลือกรายการหลัก", true);
        return;
      }
      const sourceIds = selected
        .map((item) => Number(item?.id || 0))
        .filter((id) => id && id !== masterId);
      if (!sourceIds.length) {
        setStatus("raw-bulk-merge-status", "ต้องมีรายการรองอย่างน้อย 1 รายการ", true);
        return;
      }
      setStatus("raw-bulk-merge-status", "กำลัง merge รายการ...");
      const result = await api("/api/items/bulk-merge", {
        method: "POST",
        body: JSON.stringify({
          master_item_id: masterId,
          source_item_ids: sourceIds,
        }),
      });
      getRawSelectedIds().clear();
      closeRawBulkMergeModal();
      setStatus(
        "source-status",
        `merge สำเร็จ: master #${masterId} | รวม ${Number(result?.merged_count || 0)} รายการ | ย้าย source ${Number(result?.counts?.source_records_moved || 0)} | ย้าย media ${Number(result?.counts?.content_assets_moved || 0)}`
      );
      await refreshAll();
    } catch (err) {
      setStatus("raw-bulk-merge-status", err.message, true);
    }
  });
}

function wireSourceCollect() {
  qs("source-adapter")?.addEventListener("change", () => {
    updateSourceInputUI();
  });
  qs("source-use-location-restriction")?.addEventListener("change", () => {
    clearSourceLocationPanelError();
    syncSourceLocationPanelSummary();
  });
  qs("source-location-latitude")?.addEventListener("input", () => {
    normalizeSourceLocationPairInputs();
    clearSourceLocationPanelError();
    syncSourceLocationPanelSummary();
  });
  qs("source-location-longitude")?.addEventListener("input", () => {
    normalizeSourceLocationPairInputs();
    clearSourceLocationPanelError();
    syncSourceLocationPanelSummary();
  });
  qs("source-location-radius-m")?.addEventListener("input", () => {
    clearSourceLocationPanelError();
    syncSourceLocationPanelSummary();
  });
  qs("btn-source-location-panel-toggle")?.addEventListener("click", () => {
    const { panel } = getSourceLocationPanelElements();
    if (!panel || panel.classList.contains("hidden")) return;
    panel.open = !panel.open;
    syncSourceLocationPanelToggleLabel();
  });
  syncSourceLocationPanelSummary();
  syncSourceLocationPanelToggleLabel();

  qs("btn-source-collect")?.addEventListener("click", async () => {
    try {
      const selectedAdapter = syncSourceAdapterOptionsForRole();
      const query = getSourceQueryValue();
      const adapter =
        selectedAdapter === "google_maps" && looksLikeUrlInput(query)
          ? "manual"
          : selectedAdapter === "facebook" || selectedAdapter === "tiktok"
            ? "manual"
            : selectedAdapter;
      if (adapter === "google_maps") {
        const locationValidation = validateSourceLocationPanelState();
        if (!locationValidation.ok) {
          focusFirstInvalidSourceLocationField(locationValidation);
          return;
        }
      }
      const sourceLabel = String(qs("source-label")?.value || "").trim() || selectedAdapter || adapter;
      const payload = normalizeCollectPayload(adapter);

      if (selectedAdapter !== adapter && selectedAdapter === "google_maps" && adapter === "manual") {
        setStatus("source-status", "ตรวจพบลิงก์ในช่องกรอก ระบบจะนำเข้าแบบ manual_url อัตโนมัติ");
      } else if (selectedAdapter !== adapter && (selectedAdapter === "facebook" || selectedAdapter === "tiktok")) {
        setStatus("source-status", `ระบบจะนำเข้า ${selectedAdapter} ผ่าน manual_url เพื่ออ่านข้อมูลจากลิงก์ก่อนคัดรับเข้า raw`);
      }

      const result = await api("/api/collect", {
        method: "POST",
        body: JSON.stringify({
          adapter,
          source_label: sourceLabel,
          payload,
          auto_import: false,
        }),
      });
      syncSourceQueryValue("");
      resetSourceLocationPanelState();

      const rawCount = Number(result.raw_count ?? result.count ?? 0) || 0;
      if (!rawCount) {
        setStatus("source-status", `ดึงข้อมูล batch ${result.batch_uid} สำเร็จ แต่ไม่พบ candidate สำหรับคัดรับเข้า raw`, true);
        await refreshAll();
        return;
      }

      setStatus("source-status", `ดึงข้อมูล batch ${result.batch_uid} สำเร็จ (พบ ${rawCount} รายการ รอคัดรับเข้า raw)`);

      const rawItemsResponse = await api(`/api/source-raw-items?batch_uid=${encodeURIComponent(result.batch_uid)}&limit=${Math.max(rawCount, 50)}`);
      openSourceIntakeModal({
        batchUid: result.batch_uid,
        adapter,
        sourceLabel,
        query,
        rawItems: rawItemsResponse?.items || [],
      });
      await refreshAll();
    } catch (err) {
      setStatus("source-status", err.message, true);
    }
  });
}

function wireSourceIntakeModal() {
  qs("btn-source-intake-close")?.addEventListener("click", () => {
    closeSourceIntakeModal();
  });

  qs("btn-source-intake-accept-recommended")?.addEventListener("click", () => {
    const hasMergeRecommendation = state.sourceIntake.candidates.some((candidate) => candidate.recommendedDecision === "merge");
    state.sourceIntake.selectedMode = hasMergeRecommendation ? "merge" : "new";
    if (state.sourceIntake.selectedMode === "merge" && !Number(state.sourceIntake.selectedExistingItemId || 0)) {
      state.sourceIntake.selectedExistingItemId = chooseDefaultSourceIntakeExistingItemId(state.sourceIntake.candidates);
    }
    for (const candidate of state.sourceIntake.candidates) {
      candidate.selectedDecision = candidate.recommendedDecision === "skip" ? "skip" : "accept";
    }
    renderSourceIntakeModal();
  });

  qs("btn-source-intake-confirm")?.addEventListener("click", async () => {
    try {
      const mergeMode = state.sourceIntake.selectedMode === "merge";
      const existingItemId = Number(state.sourceIntake.selectedExistingItemId || 0) || 0;
      const decisions = state.sourceIntake.candidates.map((candidate) => ({
        raw_item_id: candidate.rawItemId,
        decision: candidate.selectedDecision === "accept" ? (mergeMode ? "merge" : "new") : "skip",
        existing_item_id: candidate.selectedDecision === "accept" && mergeMode ? existingItemId : null,
      }));

      const actionable = decisions.filter((row) => row.decision !== "skip");
      if (!actionable.length) {
        setStatus("source-intake-status", "ยังไม่มีรายการที่เลือกให้รับเข้า raw", true);
        return;
      }

      if (mergeMode && !existingItemId) {
        setStatus("source-intake-status", "เลือกปลายทางรายการเดิมก่อนยืนยัน merge ทั้งชุด", true);
        return;
      }

      setStatus("source-intake-status", "กำลังรับรายการเข้าระบบ...");
      const result = await api("/api/source-raw-items/import", {
        method: "POST",
        body: JSON.stringify({
          batch_uid: state.sourceIntake.batchUid,
          adapter: state.sourceIntake.adapter,
          decisions,
        }),
      });

      closeSourceIntakeModal();
      setStatus(
        "source-status",
        `รับเข้าระบบแล้ว ${result.imported_count || 0} รายการ (สร้างใหม่ ${result.new_count || 0}, merge ${result.merged_count || 0}, ข้าม ${result.skipped_count || 0})`
      );
      await refreshAll();
    } catch (err) {
      setStatus("source-intake-status", err.message, true);
    }
  });
}

function wireUserSettings() {
  qs("btn-agent-profile-toggle")?.addEventListener("click", () => {
    state.agentProfilePanelOpen = !state.agentProfilePanelOpen;
    renderAgentProfilePanel();
  });
  qs("agent-profile-select")?.addEventListener("change", (event) => {
    state.selectedAgentProfileKey = String(event.target?.value || "field_pack_agent").trim().toLowerCase();
    renderAgentProfilePanel();
  });
  qs("btn-agent-profile-save")?.addEventListener("click", async () => {
    try {
      await saveSelectedAgentProfile();
      setStatus("agent-profile-status", "บันทึก Agent Profile แล้ว");
    } catch (err) {
      setStatus("agent-profile-status", err.message, true);
    }
  });
  qs("btn-agent-profile-reset")?.addEventListener("click", async () => {
    if (!window.confirm("Reset Agent Profile กลับเป็นค่าเริ่มต้นใช่หรือไม่?")) return;
    try {
      await resetSelectedAgentProfile();
      setStatus("agent-profile-status", "คืนค่า Agent Profile เริ่มต้นแล้ว");
    } catch (err) {
      setStatus("agent-profile-status", err.message, true);
    }
  });
  qs("btn-ai-policy-toggle")?.addEventListener("click", () => {
    state.aiPolicyPanelOpen = !state.aiPolicyPanelOpen;
    renderAiPolicyPanel();
  });
  qs("btn-ai-policy-load")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังโหลด...", async () => {
        await loadAiFeaturePolicies();
      });
      setStatus("ai-policy-status", "โหลด AI feature policy แล้ว");
    } catch (err) {
      setStatus("ai-policy-status", err.message, true);
    }
  });
  qs("table-ai-policy")?.querySelector("tbody")?.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-ai-policy-save]");
    if (!btn) return;
    const featureKey = String(btn.dataset.aiPolicySave || "").trim();
    if (!featureKey) return;
    const select = qs("table-ai-policy")?.querySelector(`select[data-ai-policy-feature="${featureKey}"]`);
    const policyKey = String(select?.value || "").trim();
    try {
      await withButtonLoading(btn, "กำลังบันทึก...", async () => {
        await saveAiFeaturePolicy(featureKey, policyKey);
      });
      setStatus("ai-policy-status", `บันทึก policy ของ ${featureKey} แล้ว`);
    } catch (err) {
      setStatus("ai-policy-status", err.message, true);
    }
  });
  qs("btn-data-cleanup-toggle")?.addEventListener("click", () => {
    state.dataCleanupPanelOpen = !state.dataCleanupPanelOpen;
    renderDataCleanupPanel();
  });
  qs("btn-reference-cleanup-toggle")?.addEventListener("click", async () => {
    state.referenceCleanupPanelOpen = !state.referenceCleanupPanelOpen;
    if (state.referenceCleanupPanelOpen) {
      try {
        await loadReferenceCleanupItems();
      } catch (err) {
        renderReferenceCleanupPanel();
        setStatus("reference-cleanup-status", err.message, true);
      }
    } else {
      renderReferenceCleanupPanel();
    }
  });

  qs("btn-data-cleanup-load")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังโหลด...", async () => {
        await loadDataCleanupRows({ showSuccessStatus: true });
      });
    } catch (err) {
      setStatus("data-cleanup-status", err.message, true);
    }
  });

  qs("table-data-cleanup")?.querySelector("tbody")?.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const action = String(btn.dataset.action || "").trim();
    const id = Number(btn.dataset.id || 0) || 0;
    if (!id) return;
    try {
      if (action === "cleanup-check") {
        await withButtonLoading(btn, "กำลังตรวจ...", async () => {
          const result = await api(`/api/admin/deleted-items/${id}/cleanup-check`);
          const item = result?.item || null;
          state.cleanup.rows = Array.isArray(state.cleanup?.rows)
            ? state.cleanup.rows.map((row) => (Number(row?.id || 0) === id ? item : row)).filter(Boolean)
            : [];
          state.referenceCleanupDeletedItems = Array.isArray(state.cleanup?.rows) ? state.cleanup.rows : [];
          renderDataCleanupPanel();
          renderReferenceCleanupPanel();
          setStatus("data-cleanup-status", `ตรวจรายการ #${id} แล้ว`);
        });
        return;
      }
        if (action === "cleanup-purge") {
          if (!window.confirm(`Purge item #${id} ใช่หรือไม่?`)) return;
          const reason = String(window.prompt("เหตุผลในการ purge (ไม่บังคับ)", "") || "").trim();
          await withButtonLoading(btn, "กำลัง purge...", async () => {
            await api(`/api/admin/deleted-items/${id}/purge`, {
              method: "POST",
              body: JSON.stringify({ reason }),
            });
            await loadDataCleanupRows();
            renderReferenceCleanupPanel();
            setStatus("data-cleanup-status", `purge รายการ #${id} แล้ว`);
          });
        }
      } catch (err) {
      if (action === "cleanup-purge") {
        try {
          const result = await api(`/api/admin/deleted-items/${id}/cleanup-check`);
          const item = result?.item || null;
          state.cleanup.rows = Array.isArray(state.cleanup?.rows)
            ? state.cleanup.rows.map((row) => (Number(row?.id || 0) === id ? item : row)).filter(Boolean)
            : [];
          state.referenceCleanupDeletedItems = Array.isArray(state.cleanup?.rows) ? state.cleanup.rows : [];
          renderDataCleanupPanel();
          renderReferenceCleanupPanel();
        } catch {
          // ignore follow-up refresh failure and show original purge error
        }
      }
      setStatus("data-cleanup-status", err.message, true);
    }
  });
  qs("reference-cleanup-item-id")?.addEventListener("change", (event) => {
    state.referenceCleanupSelectedItemId = Number(event.target?.value || 0) || 0;
    state.referenceCleanupReferences = null;
    state.referenceCleanupSelectedGroups = new Set();
    renderReferenceCleanupPanel();
  });
  qs("btn-reference-cleanup-load")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังโหลด...", async () => {
        const id = Number(qs("reference-cleanup-item-id")?.value || state.referenceCleanupSelectedItemId || 0) || 0;
        await loadReferencesForItem(id);
        setStatus("reference-cleanup-status", `โหลดข้อมูลอ้างอิง #${id} แล้ว`);
      });
    } catch (err) {
      setStatus("reference-cleanup-status", err.message, true);
    }
  });
  qs("reference-cleanup-candidates")?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "checkbox") return;
    const key = String(target.dataset.referenceCleanupGroup || "").trim().toLowerCase();
    if (!key) return;
    if (!REFERENCE_CLEANUP_CANDIDATE_KEYS.has(key)) return;
    if (target.checked) {
      state.referenceCleanupSelectedGroups.add(key);
    } else {
      state.referenceCleanupSelectedGroups.delete(key);
    }
    updateReferenceCleanupExecuteButton();
  });
  qs("btn-reference-cleanup-execute")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังล้าง...", async () => {
        const result = await executeReferenceCleanup();
        const cleaned = result?.cleaned && typeof result.cleaned === "object" ? result.cleaned : {};
        const summary = Object.entries(cleaned)
          .map(([key, count]) => `${key}:${Number(count || 0) || 0}`)
          .join(" | ");
        const remainingBlockers = Array.isArray(result?.remaining_blockers) ? result.remaining_blockers : [];
        const skippedAssets = Array.isArray(result?.skipped_assets) ? result.skipped_assets : [];
        const statusParts = [];
        statusParts.push(summary ? `ล้างข้อมูลแล้ว ${summary}` : "ล้างข้อมูลอ้างอิงแล้ว");
        if (remainingBlockers.length) {
          statusParts.push(`ยังมี hard blocker ${remainingBlockers.length} กลุ่ม`);
        }
        if (skippedAssets.length) {
          statusParts.push(`asset ลบต่อไม่ได้ ${skippedAssets.length} รายการ`);
        }
        setStatus("reference-cleanup-status", statusParts.join(" | "));
      });
    } catch (err) {
      setStatus("reference-cleanup-status", err.message, true);
    }
  });
}

function wireAssignments() {
  qs("assignment-expected-deliverables")?.addEventListener("input", () => {
    markAssignmentExpectedDeliverablesTouched();
  });

  qs("assignment-deliverable-asset")?.addEventListener("change", () => {
    renderAssignmentDeliverableAssetPreview();
  });
  qs("assignment-submission-capture-guide")?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches("[data-capture-file-input]")) return;
    const card = target.closest("[data-capture-upload-key]");
    if (!card) return;
    const slug = String(card.getAttribute("data-capture-upload-key") || "").trim();
    if (!slug) return;
    const assignmentId = Number(state.assignments.selectedId || 0) || 0;
    const mode = String(target.getAttribute("data-capture-mode") || "").trim().toLowerCase();
    setAssignmentCaptureLoading(assignmentId, slug, true);
    renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(getAssignmentById(assignmentId)));
    const files = Array.from(target.files || []).filter((file) => {
      const mimeType = String(file?.type || "").trim().toLowerCase();
      if (mode === "image") return mimeType.startsWith("image/");
      if (mode === "video") return mimeType.startsWith("video/");
      return mimeType.startsWith("image/") || mimeType.startsWith("video/");
    });
    appendAssignmentCaptureFiles(assignmentId, slug, files);
    target.value = "";
    syncAssignmentSubmissionDraftFromForm();
    renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(getAssignmentById(assignmentId)));
    renderAssignmentSubmissionFileList();
    window.setTimeout(() => {
      setAssignmentCaptureLoading(assignmentId, slug, false);
      if (Number(state.assignments.selectedId || 0) === assignmentId) {
        renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(getAssignmentById(assignmentId)));
      }
    }, 1400);
  });
  qs("assignment-submission-capture-guide")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-capture-remove-file]");
    if (!button) return;
    const slug = String(button.getAttribute("data-capture-upload-key") || "").trim();
    const index = Number(button.getAttribute("data-capture-file-index") || -1);
    const assignmentId = Number(state.assignments.selectedId || 0) || 0;
    if (!slug || assignmentId <= 0 || index < 0) return;
    removeAssignmentCaptureFile(assignmentId, slug, index);
    syncAssignmentSubmissionDraftFromForm();
    renderAssignmentSubmissionForm(getAssignmentSubmissionFormAssignment(getAssignmentById(assignmentId)));
    renderAssignmentSubmissionFileList();
  });
  qs("assignment-submission-verified-fields")?.addEventListener("input", () => {
    syncAssignmentSubmissionDraftFromForm();
    const assignment = getAssignmentById(state.assignments.selectedId);
    renderAssignmentSubmissionGatePanel(buildAssignmentSubmissionGateState(state.assignments.selectedId, getAssignmentSubmissionFormConfig(assignment, state.assignments.contextFieldPack)));
  });
  qs("assignment-submission-capture-guide")?.addEventListener("input", () => {
    syncAssignmentSubmissionDraftFromForm();
    const assignment = getAssignmentById(state.assignments.selectedId);
    renderAssignmentSubmissionGatePanel(buildAssignmentSubmissionGateState(state.assignments.selectedId, getAssignmentSubmissionFormConfig(assignment, state.assignments.contextFieldPack)));
  });
  qs("assignment-submission-question-fields")?.addEventListener("input", () => {
    syncAssignmentSubmissionDraftFromForm();
    const assignment = getAssignmentById(state.assignments.selectedId);
    renderAssignmentSubmissionGatePanel(buildAssignmentSubmissionGateState(state.assignments.selectedId, getAssignmentSubmissionFormConfig(assignment, state.assignments.contextFieldPack)));
  });
  qs("assignment-submission-requested-checks-fields")?.addEventListener("input", (event) => {
    const target = event.target?.closest?.("[data-requested-check-row]") || null;
    if (target) {
      updateAssignmentRequestedCheckReturnRowState(target);
      if (target.classList.contains("requested-check-row-invalid")) {
        target.classList.remove("requested-check-row-invalid");
        const messageNode = target.querySelector(".requested-check-row-validation-message");
        if (messageNode) messageNode.remove();
        const summaryNode = qs("assignment-submission-requested-checks-error");
        if (summaryNode && !document.querySelector(".requested-check-row-invalid")) {
          summaryNode.textContent = "";
          summaryNode.classList.add("hidden");
        }
      }
    }
    syncAssignmentRequestedCheckReturnDraftFromForm();
  });
  qs("assignment-submission-requested-checks-fields")?.addEventListener("change", (event) => {
    const target = event.target?.closest?.("[data-requested-check-row]") || null;
    if (target) {
      updateAssignmentRequestedCheckReturnRowState(target);
      if (target.classList.contains("requested-check-row-invalid")) {
        target.classList.remove("requested-check-row-invalid");
        const messageNode = target.querySelector(".requested-check-row-validation-message");
        if (messageNode) messageNode.remove();
        const summaryNode = qs("assignment-submission-requested-checks-error");
        if (summaryNode && !document.querySelector(".requested-check-row-invalid")) {
          summaryNode.textContent = "";
          summaryNode.classList.add("hidden");
        }
      }
    }
    syncAssignmentRequestedCheckReturnDraftFromForm();
  });
  qs("assignment-submission-additional-text")?.addEventListener("input", () => {
    syncAssignmentSubmissionDraftFromForm();
    const assignment = getAssignmentById(state.assignments.selectedId);
    renderAssignmentSubmissionGatePanel(buildAssignmentSubmissionGateState(state.assignments.selectedId, getAssignmentSubmissionFormConfig(assignment, state.assignments.contextFieldPack)));
  });
  qs("assignment-submission-brief-link")?.addEventListener("click", (event) => {
    if (event.currentTarget?.classList.contains("disabled")) {
      event.preventDefault();
    }
  });

  qs("btn-assignments-load")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังโหลด...", async () => {
        await refreshAssignments({ showStatus: true, preserveSelection: true });
      });
    } catch {
      // handled in refreshAssignments
    }
  });

  qs("assignment-assignee-id")?.addEventListener("change", () => {
    refreshAssignments({ showStatus: true, preserveSelection: false }).catch(() => {});
  });
  qs("assignment-review-tracking")?.addEventListener("change", () => {
    refreshAssignments({ showStatus: true, preserveSelection: false }).catch(() => {});
  });
  qs("assignment-review-image-reset")?.addEventListener("change", () => {
    syncAssignmentReviewResetReasonUI();
  });
  qs("assignment-review-video-reset")?.addEventListener("change", () => {
    syncAssignmentReviewResetReasonUI();
  });
  qs("assignment-create-assignee-mode")?.addEventListener("change", () => {
    syncAssignmentCreateAssigneeMode();
  });
  qs("assignment-create-kind")?.addEventListener("change", () => {
    renderAssignmentAssigneeOptions();
    renderAssignmentCreateSummary();
  });

  qs("btn-assignment-create")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังสร้าง...", async () => {
        await createAssignmentForContextItem();
      });
    } catch (err) {
      setStatus("assignment-create-status", err.message, true);
    }
  });

  qs("table-assignments")?.querySelector("tbody")?.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const action = String(btn.dataset.action || "");

    if (action === "open-assignment") {
      const id = Number(btn.dataset.id || 0);
      if (id) {
        selectAssignment(id);
        qs("assignment-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
  });

  qs("table-assignments-submitted")?.querySelector("tbody")?.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const action = String(btn.dataset.action || "");
    if (action === "open-submitted-assignment") {
      const id = Number(btn.dataset.id || 0);
      if (id) {
        selectAssignment(id, { submittedView: true });
        qs("assignment-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  });

  qs("btn-assignment-update-state")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังอัปเดต...", async () => {
        await updateAssignmentState();
      });
    } catch (err) {
      setStatus("assignment-status", err.message, true);
    }
  });

  qs("btn-assignment-submit")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังส่ง...", async () => {
        await createAssignmentSubmission();
      });
  } catch (err) {
      clearAllAssignmentRequestedCheckValidationErrors();
      displayAssignmentRequestedCheckValidationErrors(err);
      setStatus("assignment-status", err.message, true);
    }
  });

  qs("btn-assignment-sync-upload")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังซิงก์...", async () => {
        await syncAssignmentSubmissionUploads();
      });
    } catch (err) {
      setStatus("assignment-status", err.message, true);
    }
  });

  qs("btn-assignment-load-submissions")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังโหลด...", async () => {
        await loadAssignmentSubmissions();
      });
    } catch (err) {
      setStatus("assignment-status", err.message, true);
    }
  });

  qs("btn-assignment-load-deliverables")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังโหลด...", async () => {
        await loadAssignmentDeliverablesBundle();
        await loadAssignmentAssets({ showStatus: false });
      });
    } catch (err) {
      setStatus("assignment-status", err.message, true);
    }
  });

  qs("btn-assignment-create-deliverable")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังเพิ่ม...", async () => {
        await createAssignmentDeliverable();
      });
    } catch (err) {
      setStatus("assignment-status", err.message, true);
    }
  });

  qs("btn-assignment-load-history")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      await withButtonLoading(btn, "กำลังโหลด...", async () => {
        await loadAssignmentHistory();
      });
    } catch (err) {
      setStatus("assignment-status", err.message, true);
    }
  });

  qs("btn-assignment-request-revision")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      if (isAssignmentWorkOnlyUser()) {
        throw new Error("role นี้ตรวจงานไม่ได้");
      }
      await withButtonLoading(btn, "กำลังบันทึก...", async () => {
        await applyAssignmentReviewDecision("request_revision");
      });
    } catch (err) {
      setStatus("assignment-status", err.message, true);
    }
  });

  syncAssignmentReviewResetReasonUI();

  qs("btn-assignment-accept-submission")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      if (isAssignmentWorkOnlyUser()) {
        throw new Error("role นี้ตรวจงานไม่ได้");
      }
      await withButtonLoading(btn, "กำลังบันทึก...", async () => {
        await applyAssignmentReviewDecision("accept_submission");
      });
    } catch (err) {
      setStatus("assignment-status", err.message, true);
    }
  });

}

function showLandingStatus() {
  const params = new URLSearchParams(window.location.search);
  const code = String(params.get("status") || "").trim();
  const itemId = Number(params.get("item_id") || 0);
  const sourceStatus = qs("source-status");

  if (sourceStatus) {
    sourceStatus.classList.remove("sync-badge", "ok", "fail");
  }

  if (!code) return;
  if (code === "sent_main_site") {
    if (sourceStatus) {
      sourceStatus.classList.add("sync-badge", "ok");
    }
    setStatus(
      "source-status",
      `ส่งรายการ ${itemId || "นี้"} สำเร็จแล้ว ขั้นตอนถัดไป: อนุมัติบน Admin Frontend`
    );

    if (itemId) {
      window.setTimeout(() => {
        const row = document.querySelector(`#table-raw tbody tr[data-item-id="${itemId}"]`);
        row?.classList.remove("row-highlight");
      }, 3500);
    }
  }
}

wireTabs();
wireProcessTransitions();
wireAuth();
wireRawTableControls();
wireRawBulkActions();
wireSourceCollect();
updateSourceInputUI();
wireSourceIntakeModal();
wireUserSettings();
wireAssignments();
showLandingStatus();
applyAuthLandingNotice();

(async () => {
  if (!state.token) {
    applyLogoutUI();
    return;
  }

  try {
    const result = await api("/api/auth/me");
    state.user = result.user;
    const returnTo = consumeAuthReturnTo();
    const normalizedReturnTo = normalizeRoleReturnTo(currentRole(), returnTo);
    const effectiveReturnTo = getRequestedTabFromUrl() && !hasExplicitReturnToQuery() ? "" : normalizedReturnTo;
    const requestedTab = getRequestedTabFromUrl();
    const preferredSeed = requestedTab || state.preferredTab || getDefaultLandingTabForRole(currentRole());
    const resolvedLanding = resolveRequestedLandingState({ requestedTab: preferredSeed, fallbackTab: preferredSeed });
    state.preferredTab = resolvedLanding.resolvedPreferredTab;
    updateAuthUI();
    if (effectiveReturnTo && effectiveReturnTo !== getCurrentReturnToPath()) {
      window.location.assign(effectiveReturnTo);
      return;
    }
    const portalTarget = rolePortalTarget(currentRole(), parsePositiveInt(new URLSearchParams(window.location.search).get("item_id"), 0), parsePositiveInt(new URLSearchParams(window.location.search).get("assignment_id"), 0));
    if (portalTarget && String(window.location.pathname || "/") === "/" && !requestedTab) {
      window.location.assign(portalTarget);
      return;
    }
    await refreshAll();
    if (await maybeApplyEditorLanding(effectiveReturnTo)) {
      return;
    }
    applyLandingState({
      requestedTab: getRequestedTabFromUrl() || state.preferredTab,
      fallbackTab: state.preferredTab,
      syncUrl: true,
      refreshAssignments: true,
      reason: "bootstrap-auth-complete",
    });
  } catch {
    applyLogoutUI();
    redirectToLoginWithExpiredSession();
  }
})();

