const ARTICLE_STEPS = [
  { key: "intake", label: "รับงาน" },
  { key: "drafting", label: "เขียนบทความ" },
  { key: "review", label: "ตรวจและอนุมัติ" },
];

const ARTICLE_FLOW_STATUSES = ["content_in_progress", "needs_revision", "in_review", "approved", "unpublished", "published"];
const ASSIGNMENT_REQUIRED_STATUSES = ["content_in_progress", "needs_revision"];
const DIRECTORY_SYNC_TTL_MS = 5 * 60 * 1000;
const DIRECTORY_SYNC_CACHE_KEY = "collector_users_last_directory_sync_at";

const INTAKE_GROUPS = [
  { key: "needs_attention", label: "ต้องจัดการตอนนี้", empty: "ยังไม่มีงานที่ต้องจัดการตอนนี้" },
  { key: "drafting", label: "กำลังเขียน", empty: "ยังไม่มีงานที่กำลังเขียน" },
  { key: "review", label: "รอตรวจและอนุมัติ", empty: "ยังไม่มีงานที่รอตรวจและอนุมัติ" },
  { key: "admin_review", label: "รอ Admin Review", empty: "ยังไม่มีงานที่ส่งเข้า Admin Review" },
  { key: "done", label: "เสร็จแล้ว", empty: "ยังไม่มีงานที่เสร็จแล้ว" },
];

const state = {
  token: sessionStorage.getItem("collector_token") || localStorage.getItem("collector_token") || "",
  user: null,
  items: [],
  processByItemId: {},
  editorAssignmentByItemId: {},
  itemId: Number(new URLSearchParams(window.location.search).get("id") || 0),
  scope: String(new URLSearchParams(window.location.search).get("scope") || "place").trim().toLowerCase() || "place",
  item: null,
  articleProcess: null,
  assignableUsers: [],
  busy: false,
  directorySyncInFlight: false,
  directoryLastSyncedAt: 0,
};

function normalizedValue(value) {
  return String(value || "").trim().toLowerCase();
}

function qs(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : null;
}

function setBanner(message, kind = "success") {
  const node = qs("workspace-status");
  if (!node) return;
  const text = String(message || "").trim();
  if (!text) {
    node.textContent = "";
    node.classList.add("hidden");
    node.classList.remove("is-loading", "is-success", "is-error");
    return;
  }
  node.textContent = text;
  node.classList.remove("hidden", "is-loading", "is-success", "is-error");
  if (kind === "loading") node.classList.add("is-loading");
  else if (kind === "error") node.classList.add("is-error");
  else node.classList.add("is-success");
}

function setInlineStatus(id, message, kind = "success") {
  const node = qs(id);
  if (!node) return;
  const text = String(message || "").trim();
  node.textContent = text;
  node.className = text ? `status ${kind === "error" ? "error" : kind === "loading" ? "muted" : "ok"}` : "status";
}

function currentRole() {
  return String(state.user?.role || "").trim().toLowerCase();
}

function isEditorUser() {
  return currentRole() === "editor";
}

function canManageAssignments() {
  const role = currentRole();
  return role === "owner" || role === "admin" || role === "user";
}

function canRunDirectorySync() {
  const role = currentRole();
  return role === "owner" || role === "admin";
}

function canAccessArticleIntake() {
  return canManageAssignments();
}

function articleIntakeFallbackUrl() {
  const role = currentRole();
  const itemId = Number(state.itemId || 0) || 0;
  if (role === "editor") {
    return itemId > 0 ? `/editor-home.html?item_id=${itemId}` : "/editor-home.html";
  }
  if (role === "freelance") {
    return itemId > 0 ? `/freelance-home.html?item_id=${itemId}` : "/freelance-home.html";
  }
  if (state.scope === "event") {
    return "/events-manager.html";
  }
  return "/";
}

function applyEditorWorkerView() {
  if (!isEditorUser()) return;
  document.title = "Collector - งานเขียนของฉัน";
  const heading = document.querySelector(".header .auth-row h1");
  if (heading) heading.textContent = "งานเขียนของฉัน";
  const subheading = document.querySelector(".header .auth-row p");
  if (subheading) subheading.textContent = "เปิดงานที่กำลังเขียน แล้วทำต่อจากหน้านี้ได้ทันที";
  const processBar = qs("article-process-bar");
  if (processBar) processBar.classList.add("hidden");
  const statusCard = qs("article-process-summary")?.closest(".article-card-status") || null;
  if (statusCard) statusCard.classList.add("hidden");
  const activityCard = qs("article-activity-log")?.closest(".article-card-activity") || null;
  if (activityCard) activityCard.classList.add("hidden");
  const queueTitle = qs("article-intake-summary")?.closest(".article-section-head")?.querySelector(".section-title") || null;
  if (queueTitle) queueTitle.textContent = "งานที่กำลังเขียน";
}

function currentAssignments() {
  return Array.isArray(state.articleProcess?.editorial_assignments) ? state.articleProcess.editorial_assignments : [];
}

function primaryAssignment() {
  return state.articleProcess?.active_editorial_assignment || currentAssignments()[0] || null;
}

function processForItem(itemId) {
  return state.processByItemId[Number(itemId || 0)] || null;
}

function articleProcessStatusForItem(item) {
  const process = processForItem(item?.id);
  const processStatus = normalizedValue(process?.status);
  if (processStatus === "submitted_for_admin_review") return "submitted_for_admin_review";
  if (processStatus === "synced_to_admin") return "synced_to_admin";
  if (processStatus) return processStatus;
  const productionState = normalizedValue(item?.production_state);
  if (productionState === "submitted_for_admin_review") return "submitted_for_admin_review";
  const publicationState = normalizedValue(item?.publication_state);
  if (publicationState === "published") return "synced_to_admin";
  return "";
}

function primaryAssignmentForItem(itemId) {
  const fallbackAssignment = state.editorAssignmentByItemId?.[Number(itemId || 0)] || null;
  const process = processForItem(itemId);
  if (!process) return fallbackAssignment;
  if (process.active_editorial_assignment) return process.active_editorial_assignment;
  const assignments = Array.isArray(process.editorial_assignments) ? process.editorial_assignments : [];
  return assignments[0] || fallbackAssignment;
}

function hasAssignedWriter(item) {
  const assignment = primaryAssignmentForItem(item?.id);
  if (!assignment) return false;
  return Boolean(
    Number(assignment?.assignee_user_id || 0)
    || String(assignment?.assignee_display_name || assignment?.assignee_name || assignment?.assignee_email || "").trim()
  );
}

function workflowTransitions() {
  return Array.isArray(state.articleProcess?.workflow_transitions) ? state.articleProcess.workflow_transitions : [];
}

function articleStatus() {
  const status = String(state.articleProcess?.status || "").trim().toLowerCase();
  if (status) return status;
  const productionState = normalizedValue(state.item?.production_state);
  const publicationState = normalizedValue(state.item?.publication_state);
  if (productionState === "submitted_for_admin_review") return "submitted_for_admin_review";
  if (publicationState === "published") return "synced_to_admin";
  if (publicationState === "approved" || publicationState === "unpublished") return "ready_for_sync";
  const workflowStatus = derivedArticleWorkflowStatus(state.item);
  if (workflowStatus === "published") return "synced_to_admin";
  if (workflowStatus === "approved" || workflowStatus === "unpublished") return "ready_for_sync";
  if (workflowStatus === "in_review") return "ready_for_review";
  if (workflowStatus === "needs_revision") return "revision_requested";
  if (workflowStatus === "content_in_progress") return "drafting";
  return "drafting";
}

function articleStatusLabel(status = articleStatus()) {
  if (status === "ready_for_review") return "รอตรวจและอนุมัติ";
  if (status === "ready_for_sync") return "พร้อมส่งเข้า Admin Review";
  if (status === "submitted_for_admin_review") return "ส่งเข้า Admin Review แล้ว";
  if (status === "synced_to_admin") return "เผยแพร่แล้ว";
  if (status === "revision_requested") return "ต้องแก้ไข";
  return "กำลังเขียนบทความ";
}

function isAdminReviewLockedStatus(status = articleStatus()) {
  const normalized = normalizedValue(status);
  return normalized === "submitted_for_admin_review" || normalized === "synced_to_admin";
}

function shouldOpenReviewSurface(status = articleStatus()) {
  return status === "ready_for_review" || status === "ready_for_sync";
}

function shouldOpenLockedInspectionSurface(status = articleStatus()) {
  return isAdminReviewLockedStatus(status);
}

function isLockedQueueGroup(groupKey = "") {
  const normalized = normalizedValue(groupKey);
  return normalized === "admin_review" || normalized === "done" || normalized === "published" || normalized === "locked";
}

function canOpenWorkspaceSurface(status = articleStatus()) {
  return status === "drafting" || status === "revision_requested";
}

function processIndex() {
  return 1;
}

function renderProcessBar() {
  const root = qs("article-process-bar");
  if (!root) return;
  const index = processIndex();
  root.innerHTML = ARTICLE_STEPS.map((step, stepIndex) => {
    const uiIndex = stepIndex + 1;
    const completed = uiIndex < index;
    const active = uiIndex === index;
    return `
      <div class="step${completed ? " completed" : ""}${active ? " active" : ""}">
        <div class="dot">${uiIndex}</div>
        <div class="label">${escapeHtml(step.label)}</div>
      </div>
    `;
  }).join("");
}

function formatDateTime(value) {
  if (!value) return "-";
  const normalized = String(value).trim().replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  });
}

function renderStatusSummary() {
  const authNode = qs("workspace-auth-status");
  if (authNode) {
    authNode.textContent = state.user
      ? `ล็อกอินเป็น ${state.user.display_name || state.user.email || "unknown"} (${currentRole() || "-"})`
      : "ยังไม่ได้ล็อกอิน";
  }
  const box = qs("article-process-summary");
  if (!box) return;
  if (!state.item) {
    box.classList.remove("hidden");
    box.innerHTML = '<p class="muted">เลือกงานจากตารางก่อน</p>';
    return;
  }
  const assignment = primaryAssignment();
  const locked = isAdminReviewLockedStatus();
  const nextStepLabel = isEditorUser()
    ? (locked ? "ส่งเข้า Admin Review แล้ว" : shouldOpenReviewSurface() ? "รอผลตรวจ" : "เปิดหน้าเขียนบทความ")
    : (locked ? "รอ Admin Review" : shouldOpenReviewSurface() ? "เปิดหน้าตรวจและอนุมัติ" : "เปิดหน้าเขียนบทความ");
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="summary-row"><strong>สถานะปัจจุบัน</strong><span>${escapeHtml(articleStatusLabel())}</span></div>
    <div class="summary-row"><strong>สิทธิ์ของฉัน</strong><span>${escapeHtml(currentRole() || "-")}</span></div>
    <div class="summary-row"><strong>ผู้รับผิดชอบ</strong><span>${escapeHtml(assignment?.assignee_display_name || assignment?.assignee_email || assignment?.assignee_name || "-")}</span></div>
    <div class="summary-row"><strong>กำหนดส่ง</strong><span>${escapeHtml(formatDateTime(assignment?.due_at))}</span></div>
    <div class="summary-row"><strong>ขั้นถัดไป</strong><span>${escapeHtml(nextStepLabel)}</span></div>
  `;
}

function renderAssignmentControls() {
  const assignmentCard = qs("editor-assignee-select")?.closest(".article-card-assignment")
    || qs("editorial-assignment-list")?.closest(".article-card-assignment")
    || null;
  if (assignmentCard) assignmentCard.classList.toggle("hidden", isEditorUser());

  const select = qs("editor-assignee-select");
  const externalNameInput = qs("editor-external-name");
  const externalContactInput = qs("editor-external-contact");
  const activeAssignment = primaryAssignment();
  if (select) {
    const currentAssigneeId = Number(activeAssignment?.assignee_user_id || 0);
    const options = ['<option value="">เลือกผู้รับผิดชอบ</option>'];
    for (const user of state.assignableUsers) {
      const id = Number(user?.id || 0);
      const label = String(user?.display_name || user?.email || `user #${id}`).trim();
      const role = String(user?.role || "").trim().toLowerCase();
      options.push(`<option value="${id}" ${id === currentAssigneeId ? "selected" : ""}>${escapeHtml(label)} (${escapeHtml(role)})</option>`);
    }
    select.innerHTML = options.join("");
  }
  if (externalNameInput) {
    externalNameInput.value = Number(activeAssignment?.assignee_user_id || 0)
      ? ""
      : String(activeAssignment?.assignee_display_name || activeAssignment?.assignee_name || "").trim();
  }
  if (externalContactInput) {
    externalContactInput.value = Number(activeAssignment?.assignee_user_id || 0)
      ? ""
      : String(activeAssignment?.assignee_email || activeAssignment?.assignee_contact || "").trim();
  }

  const list = qs("editorial-assignment-list");
  if (!list) return;
  const assignments = currentAssignments();
  if (!assignments.length) {
    list.innerHTML = '<p class="muted">ยังไม่มี editorial assignment</p>';
    return;
  }
  list.innerHTML = assignments.map((row) => `
    <div class="article-assignment-row">
      <strong>${escapeHtml(row.assignee_display_name || row.assignee_email || row.assignee_name || `user #${Number(row.assignee_user_id || 0)}`)}</strong>
      <span>${escapeHtml(String(row.state || "").trim() || "-")}</span>
      <span>${escapeHtml(formatDateTime(row.due_at))}</span>
    </div>
  `).join("");
}

function renderActivityLog() {
  const root = qs("article-activity-log");
  if (!root) return;
  if (!state.item) {
    root.innerHTML = '<p class="muted">เลือกงานจากตารางก่อน</p>';
    return;
  }
  const rows = [];
  const assignment = primaryAssignment();
  if (assignment?.internal_note) {
    rows.push({
      title: "Assignment Note",
      note: String(assignment.internal_note || "").trim(),
      meta: `${assignment.assignee_display_name || assignment.assignee_email || assignment.assignee_name || "editor"} Â· ${formatDateTime(assignment.updated_at || assignment.created_at)}`,
    });
  }
  for (const transition of workflowTransitions()) {
    const fromState = String(transition?.from_state || "").trim() || "-";
    const toState = String(transition?.to_state || "").trim() || "-";
    const reason = String(transition?.reason_code || "").trim() || "workflow";
    rows.push({
      title: `${fromState} -> ${toState}`,
      note: String(transition?.note || "").trim() || "ไม่มีโน้ต",
      meta: `${transition?.actor_email || "-"} Â· ${reason} Â· ${formatDateTime(transition?.created_at)}`,
    });
  }
  if (!rows.length) {
    root.innerHTML = '<p class="muted">ยังไม่มี activity log ของ article workflow</p>';
    return;
  }
  root.innerHTML = rows.map((row) => `
    <div class="article-activity-row">
      <strong>${escapeHtml(row.title)}</strong>
      <p>${escapeHtml(row.note)}</p>
      <span>${escapeHtml(row.meta)}</span>
    </div>
  `).join("");
}

function derivedArticleWorkflowStatus(item, process = processForItem(item?.id)) {
  const processStatus = normalizedValue(process?.status);
  if (processStatus === "synced_to_admin") return "published";
  if (processStatus === "submitted_for_admin_review") return "submitted_for_admin_review";
  if (processStatus === "ready_for_sync") return "approved";
  if (processStatus === "ready_for_review") return "in_review";
  if (processStatus === "revision_requested") return "needs_revision";
  if (processStatus === "drafting") return "content_in_progress";

  const publicationState = normalizedValue(item?.publication_state);
  if (publicationState === "published") return "published";
  if (publicationState === "ready_for_sync" || publicationState === "approved") return "approved";

  const productionState = normalizedValue(item?.production_state);
  if (productionState === "submitted_for_admin_review") return "submitted_for_admin_review";
  if (productionState === "in_review" || productionState === "review") return "in_review";
  if (productionState === "needs_revision") return "needs_revision";
  if (
    productionState === "generated"
    || productionState === "analyzed"
    || productionState === "content_in_progress"
    || productionState === "drafting"
  ) {
    return "content_in_progress";
  }
  return "collected";
}

function isArticleQueueCandidate(item) {
  const workflowStatus = derivedArticleWorkflowStatus(item);
  const assignmentState = normalizedValue(item?.assignment_state);
  if (assignmentState === "accepted") return true;
  if (workflowStatus === "submitted_for_admin_review" || workflowStatus === "published") return true;
  return ARTICLE_FLOW_STATUSES.includes(workflowStatus);
}

function needsProcessPrefetch(item) {
  const workflowStatus = derivedArticleWorkflowStatus(item);
  const assignmentState = normalizedValue(item?.assignment_state);
  if (assignmentState === "accepted" && !ARTICLE_FLOW_STATUSES.includes(workflowStatus)) return true;
  return ASSIGNMENT_REQUIRED_STATUSES.includes(workflowStatus);
}

function queueStageMeta(item) {
  const workflowStatus = derivedArticleWorkflowStatus(item);
  const assignmentState = normalizedValue(item?.assignment_state);
  if (assignmentState === "accepted" && !ARTICLE_FLOW_STATUSES.includes(workflowStatus)) {
    return { stageLabel: "รับงาน", note: "ผ่านจากกระบวนการส่งงานไปทำแล้ว" };
  }
  if (needsProcessPrefetch(item) && !hasAssignedWriter(item)) {
    return { stageLabel: "รอมอบหมาย", note: "ต้อง assign ผู้รับงานก่อนเริ่มเขียน" };
  }
  if (workflowStatus === "content_in_progress" || workflowStatus === "needs_revision") {
    return { stageLabel: "เขียนบทความ", note: "อยู่ในขั้น authoring" };
  }
  if (workflowStatus === "in_review") {
    return { stageLabel: "ตรวจและอนุมัติ", note: "รอตรวจ final review" };
  }
  if (workflowStatus === "submitted_for_admin_review") {
    return { stageLabel: "รอ Admin Review", note: "ส่งเข้า Admin Review แล้ว เปิดดูได้แบบ inspection เท่านั้น" };
  }
  if (workflowStatus === "approved" || workflowStatus === "unpublished") {
    return { stageLabel: "ตรวจและอนุมัติ", note: "อนุมัติแล้ว และส่งเข้า Admin Review แล้ว" };
  }
  if (workflowStatus === "published") {
    return { stageLabel: "เผยแพร่แล้ว", note: "งานนี้เสร็จสิ้นแล้ว เปิดดูได้แบบ inspection เท่านั้น" };
  }
  return { stageLabel: "รับงาน", note: "-" };
}

function queueRows() {
  const rows = (Array.isArray(state.items) ? state.items : [])
    .filter((item) => isArticleQueueCandidate(item))
    .filter((item) => isPlaceItem(item) || isEventItem(item))
    .filter((item) => state.scope === "event" ? isEventItem(item) : isPlaceItem(item))
    .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
  if (!isEditorUser()) return rows;
  const selfId = Number(state.user?.id || 0) || 0;
  return rows.filter((item) => {
    const group = queueGroupKey(item);
    if (group !== "drafting" && group !== "review" && group !== "admin_review" && group !== "done") return false;
    const status = articleProcessStatusForItem(item) || derivedArticleWorkflowStatus(item);
    if (isAdminReviewLockedStatus(status) || isLockedQueueGroup(group)) return true;
    const assignment = primaryAssignmentForItem(item?.id);
    return Number(assignment?.assignee_user_id || 0) === selfId;
  });
}

function queueGroupKey(item) {
  const workflowStatus = derivedArticleWorkflowStatus(item);
  const assignmentState = normalizedValue(item?.assignment_state);

  if (assignmentState === "accepted" && !ARTICLE_FLOW_STATUSES.includes(workflowStatus)) {
    return "needs_attention";
  }
  if (needsProcessPrefetch(item) && !hasAssignedWriter(item)) {
    return "needs_attention";
  }
  if (workflowStatus === "content_in_progress" || workflowStatus === "needs_revision") {
    return "drafting";
  }
  if (workflowStatus === "submitted_for_admin_review") {
    return "admin_review";
  }
  if (workflowStatus === "in_review" || workflowStatus === "approved" || workflowStatus === "unpublished") {
    return "review";
  }
  if (workflowStatus === "published") {
    return "done";
  }
  return "needs_attention";
}

function isEventItem(item) {
  return String(item?.type || "").trim().toLowerCase() === "event";
}

function isPlaceItem(item) {
  return String(item?.type || "").trim().toLowerCase() === "place";
}

function workspaceUrl(itemId = state.itemId) {
  return `/article-workspace.html?id=${Number(itemId || 0) || 0}`;
}

function reviewUrl(itemId = state.itemId) {
  return `/article-submit.html?id=${Number(itemId || 0) || 0}`;
}

function eventWorkspaceUrl(itemId = state.itemId) {
  return `/event-workspace.html?id=${Number(itemId || 0) || 0}`;
}

function eventReviewUrl(itemId = state.itemId) {
  return `/event-submit.html?id=${Number(itemId || 0) || 0}`;
}

function lockedInspectionUrl(item) {
  const id = Number(item?.id || 0) || 0;
  if (!id) return "/";
  return isEventItem(item) ? `/event-submit.html?id=${id}` : `/article-submit.html?id=${id}`;
}

function primaryEntryUrl(item) {
  const processStatus = articleProcessStatusForItem(item);
  const workflowStatus = derivedArticleWorkflowStatus(item);
  const workspaceHref = isEventItem(item) ? eventWorkspaceUrl(Number(item?.id || 0)) : workspaceUrl(Number(item?.id || 0));
  const reviewHref = isEventItem(item) ? eventReviewUrl(Number(item?.id || 0)) : reviewUrl(Number(item?.id || 0));
  if (isAdminReviewLockedStatus(processStatus || workflowStatus)) return lockedInspectionUrl(item);
  if (isEditorUser()) {
    return workspaceHref;
  }
  if (
    processStatus === "ready_for_review"
    || processStatus === "ready_for_sync"
    || workflowStatus === "in_review"
    || workflowStatus === "approved"
    || workflowStatus === "unpublished"
  ) {
    return reviewHref;
  }
  return workspaceHref;
}

function queueActionMeta(item) {
  const group = queueGroupKey(item);
  if (group === "needs_attention") {
    return { label: "\u0e08\u0e31\u0e14\u0e01\u0e32\u0e23\u0e07\u0e32\u0e19", mode: "select" };
  }
  if (group === "drafting") {
    return { label: "\u0e40\u0e1b\u0e34\u0e14\u0e2b\u0e19\u0e49\u0e32\u0e40\u0e02\u0e35\u0e22\u0e19", mode: "open" };
  }
  if (group === "review") {
    return isEditorUser()
      ? { label: "\u0e15\u0e34\u0e14\u0e15\u0e32\u0e21\u0e2a\u0e16\u0e32\u0e19\u0e30", mode: "open" }
      : { label: "\u0e44\u0e1b\u0e2b\u0e19\u0e49\u0e32\u0e15\u0e23\u0e27\u0e08", mode: "open" };
  }
  if (group === "admin_review") {
    return { label: "รอ Admin Review", mode: "open" };
  }
  if (group === "done") {
    return { label: "ดูสถานะ", mode: "open" };
  }
  return { label: "\u0e14\u0e39\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14", mode: "open" };
}

function renderQueue() {
  const summaryNode = qs("article-intake-summary");
  const root = qs("article-intake-groups");
  if (!summaryNode || !root) return;
  const rows = queueRows();
  summaryNode.textContent = isEditorUser()
    ? (rows.length ? `มีงานของฉัน ${rows.length} งาน` : "ยังไม่มีงานของฉันในคิว")
    : (rows.length
      ? `ทั้งหมด ${rows.length} งานใน article flow`
      : "ยังไม่มีงานที่เข้าสู่ article flow");

  const visibleGroups = isEditorUser()
    ? INTAKE_GROUPS.filter((group) => group.key === "drafting" || group.key === "review" || group.key === "admin_review" || group.key === "done")
    : INTAKE_GROUPS;
  const grouped = new Map(visibleGroups.map((group) => [group.key, []]));
  rows.forEach((item) => {
    grouped.get(queueGroupKey(item))?.push(item);
  });

  root.innerHTML = visibleGroups.map((group) => {
    const items = grouped.get(group.key) || [];
    const body = items.length
      ? `
        <div class="table-wrap">
          <table class="basic-table article-intake-group-table">
            <thead>
              <tr>
                <th>งาน</th>
                <th>สถานะสำหรับผู้แจกงาน</th>
                <th>สิ่งที่ต้องทำตอนนี้</th>
                <th>การทำงาน</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item) => {
                const id = Number(item?.id || 0) || 0;
                const meta = queueStageMeta(item);
                const action = queueActionMeta(item);
                const selected = Number(state.itemId || 0) === id ? " is-selected" : "";
                return `
                  <tr class="${selected.trim()}">
                    <td>
                      <div><strong>${id}</strong></div>
                      <div class="muted">${escapeHtml(item?.title || "-")}</div>
                      ${isEventItem(item) ? '<div><span class="workflow-badge workflow-badge-generated">Event</span></div>' : ""}
                    </td>
                    <td><span class="release-stage-chip">${escapeHtml(meta.stageLabel)}</span></td>
                    <td>${escapeHtml(meta.note)}</td>
                    <td class="table-actions">
                      <button type="button" data-action="select-item" data-id="${id}">เลือกงาน</button>
                      <button type="button" data-action="${action.mode === "open" ? "open-item" : "manage-item"}" data-id="${id}">${escapeHtml(action.label)}</button>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      `
      : `<p class="muted">${escapeHtml(group.empty)}</p>`;

    return `
      <section class="article-intake-group">
        <div class="article-intake-group-head">
          <h3 class="section-title">${escapeHtml(group.label)}</h3>
          <span class="muted">${items.length} งาน</span>
        </div>
        ${body}
      </section>
    `;
  }).join("");

  root.querySelectorAll("button[data-action='select-item']").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.id || 0) || 0;
      if (!id) return;
      await loadSelectedItem(id);
      renderAll();
    });
  });

  root.querySelectorAll("button[data-action='manage-item']").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.id || 0) || 0;
      if (!id) return;
      await loadSelectedItem(id);
      renderAll();
      qs("editor-assignee-select")?.focus();
    });
  });

  root.querySelectorAll("button[data-action='open-item']").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.id || 0) || 0;
      const item = queueRows().find((row) => Number(row?.id || 0) === id) || null;
      if (!item) return;
      window.location.href = primaryEntryUrl(item);
    });
  });
}

function applyActionGuards() {
  const hasSelection = Boolean(state.item && state.itemId);
  const assignmentBtn = qs("btn-assign-editor");
  if (assignmentBtn) assignmentBtn.disabled = state.busy || !hasSelection || !canManageAssignments();

  const openWorkspaceBtn = qs("btn-open-selected-workspace");
  if (openWorkspaceBtn) openWorkspaceBtn.disabled = !hasSelection || !canOpenWorkspaceSurface();
}

async function loadAssignableUsers() {
  if (!canManageAssignments()) {
    state.assignableUsers = [];
    state.directoryLastSyncedAt = 0;
    return;
  }
  try {
    const users = await api("/api/users/assignable?kind=editorial");
    const serverSyncIso = String(users?.directory_last_synced_at || "").trim();
    const serverSyncEpoch = serverSyncIso ? Date.parse(serverSyncIso) : 0;
    state.directoryLastSyncedAt = Number.isFinite(serverSyncEpoch) && serverSyncEpoch > 0
      ? serverSyncEpoch
      : 0;
    const rows = Array.isArray(users?.items) ? users.items : [];
    state.assignableUsers = rows.filter((row) => {
      const role = String(row?.role || "").trim().toLowerCase();
      return role === "editor" || role === "user" || role === "admin" || role === "owner";
    });
  } catch {
    state.assignableUsers = [];
    state.directoryLastSyncedAt = 0;
  }
}

async function loadEditorArticleItems() {
  const selfId = Number(state.user?.id || 0) || 0;
  if (!selfId) return [];
  const response = await api(`/api/assignments/mine?assignee_user_id=${selfId}&limit=50`);
  const assignments = Array.isArray(response?.assignments) ? response.assignments : [];
  state.editorAssignmentByItemId = Object.fromEntries(
    assignments
      .filter((row) => String(row?.assignment_kind || "").trim().toLowerCase() === "editorial")
      .map((row) => [Number(row?.content_item_id || 0) || 0, row])
      .filter(([itemId]) => itemId > 0)
  );
  const itemIds = Array.from(new Set(
    assignments
      .map((row) => Number(row?.content_item_id || 0) || 0)
      .filter(Boolean)
  ));
  const items = await Promise.all(
    itemIds.map(async (itemId) => {
      try {
        return await api(`/api/items/${itemId}`);
      } catch {
        return null;
      }
    })
  );
  return items.filter(Boolean);
}

async function loadSelectedItem(itemId) {
  state.itemId = Number(itemId || 0) || 0;
  if (!state.itemId) {
    state.item = null;
    state.articleProcess = null;
    return;
  }
  const [item, processPayload] = await Promise.all([
    api(`/api/items/${state.itemId}`),
    api(`/api/items/${state.itemId}/article-process`),
  ]);
  state.item = item;
  state.articleProcess = processPayload;
  state.processByItemId[state.itemId] = processPayload;
}

async function prefetchProcessSummaries() {
  const entries = await Promise.all(
    queueRows()
      .filter((item) => needsProcessPrefetch(item))
      .map(async (item) => {
        const itemId = Number(item?.id || 0) || 0;
        if (!itemId) return null;
        try {
          const process = await api(`/api/items/${itemId}/article-process`);
          return [itemId, process];
        } catch {
          return [itemId, null];
        }
      })
  );
  state.processByItemId = Object.fromEntries(entries.filter(Boolean));
}

async function loadIntake() {
  const me = await api("/api/auth/me");
  state.user = me?.user || null;
  state.editorAssignmentByItemId = {};
  if (state.scope === "event" && !isEditorUser()) {
    window.location.replace("/events-manager.html");
    throw new Error("event ต้องเปิดผ่าน events-manager");
  }
  if (!canAccessArticleIntake()) {
    window.location.replace(articleIntakeFallbackUrl());
    throw new Error("\u0e1a\u0e31\u0e0d\u0e0a\u0e35\u0e19\u0e35\u0e49\u0e44\u0e21\u0e48\u0e21\u0e35\u0e2a\u0e34\u0e17\u0e18\u0e34\u0e4c\u0e40\u0e02\u0e49\u0e32\u0e2b\u0e19\u0e49\u0e32\u0e23\u0e31\u0e1a\u0e07\u0e32\u0e19\u0e1a\u0e17\u0e04\u0e27\u0e32\u0e21");
}
  state.items = isEditorUser()
    ? await loadEditorArticleItems()
    : await api("/api/items");
  const available = queueRows();
  if (!state.itemId && available.length) {
    state.itemId = Number(available[0]?.id || 0) || 0;
  }
    if (state.itemId) {
      const selectedItem = available.find((item) => Number(item?.id || 0) === Number(state.itemId || 0)) || null;
      if (selectedItem && isEventItem(selectedItem) && !isEditorUser()) {
        window.location.replace("/events-manager.html");
        throw new Error("event ต้องเปิดผ่าน events-manager");
      }
      state.item = selectedItem;
      state.articleProcess = state.processByItemId[state.itemId] || null;
    }
}

function readDirectorySyncTimestamp() {
  try {
    const value = Number(sessionStorage.getItem(DIRECTORY_SYNC_CACHE_KEY) || 0) || 0;
    return value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeDirectorySyncTimestamp(value) {
  try {
    sessionStorage.setItem(DIRECTORY_SYNC_CACHE_KEY, String(Number(value || Date.now()) || Date.now()));
  } catch {
    // no-op: missing sessionStorage should not break intake page
  }
}

function shouldBackgroundSyncDirectory() {
  if (!canRunDirectorySync()) return false;
  if (state.directorySyncInFlight) return false;
  const localSyncedAt = readDirectorySyncTimestamp();
  const serverSyncedAt = Number(state.directoryLastSyncedAt || 0) || 0;
  const lastSyncedAt = Math.max(localSyncedAt, serverSyncedAt);
  if (!lastSyncedAt) return true;
  return (Date.now() - lastSyncedAt) >= DIRECTORY_SYNC_TTL_MS;
}

async function runBackgroundDirectorySyncIfStale() {
  if (!shouldBackgroundSyncDirectory()) return;
  state.directorySyncInFlight = true;
  try {
    const result = await api("/api/users/sync", { method: "POST" });
    const freshnessUpdated = Boolean(result?.freshness_updated);
    const failedCount = Number(result?.failed_count || 0) || 0;
    const syncedAtRaw = String(result?.last_synced_at || "").trim();
    const syncedAtEpoch = syncedAtRaw ? Date.parse(syncedAtRaw) : 0;
    if (freshnessUpdated && Number.isFinite(syncedAtEpoch) && syncedAtEpoch > 0) {
      state.directoryLastSyncedAt = syncedAtEpoch;
      writeDirectorySyncTimestamp(syncedAtEpoch);
    }
    await loadAssignableUsers();
    renderAssignmentControls();
    applyActionGuards();
    const updatedCount = Number(result?.updated_count || 0) || 0;
    const createdCount = Number(result?.created_count || 0) || 0;
    const deactivatedCount = Number(result?.deactivated_count || 0) || 0;
    if (freshnessUpdated && (updatedCount || createdCount || deactivatedCount)) {
      setInlineStatus("assignment-status", "อัปเดตรายชื่อผู้รับงานล่าสุดแล้ว", "success");
    } else if (!freshnessUpdated && (failedCount > 0 || updatedCount || createdCount || deactivatedCount)) {
      setInlineStatus("assignment-status", "ซิงก์รายชื่อยังไม่สมบูรณ์ ระบบจะลองอัปเดตใหม่อัตโนมัติ", "warning");
    }
  } catch {
    // keep local projection as fallback; do not break the page
  } finally {
    state.directorySyncInFlight = false;
  }
}

async function hydrateIntakeDetails() {
  await Promise.all([
    prefetchProcessSummaries(),
    loadAssignableUsers(),
  ]);
  const available = queueRows();
  if (!state.itemId && available.length) {
    state.itemId = Number(available[0]?.id || 0) || 0;
  }
    if (!state.itemId) return;
    const selectedItem = available.find((item) => Number(item?.id || 0) === Number(state.itemId || 0)) || null;
    if (selectedItem && isEventItem(selectedItem) && !isEditorUser()) {
    window.location.replace("/events-manager.html");
    throw new Error("event ต้องเปิดผ่าน events-manager");
  }
  const stillExists = available.some((item) => Number(item?.id || 0) === Number(state.itemId || 0));
  if (stillExists) {
    await loadSelectedItem(state.itemId);
    return;
  }
  if (available.length) {
    await loadSelectedItem(Number(available[0]?.id || 0) || 0);
  }
}

async function assignEditor() {
  if (!state.itemId) throw new Error("\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e07\u0e32\u0e19\u0e01\u0e48\u0e2d\u0e19");
  const assigneeId = Number(qs("editor-assignee-select")?.value || 0);
  const externalName = String(qs("editor-external-name")?.value || "").trim();
  const externalContact = String(qs("editor-external-contact")?.value || "").trim();
  if (!assigneeId && !externalName) throw new Error("\u0e01\u0e23\u0e38\u0e13\u0e32\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e1c\u0e39\u0e49\u0e23\u0e31\u0e1a\u0e1c\u0e34\u0e14\u0e0a\u0e2d\u0e1a\u0e2b\u0e23\u0e37\u0e2d\u0e23\u0e30\u0e1a\u0e38 editor \u0e20\u0e32\u0e22\u0e19\u0e2d\u0e01");
  setInlineStatus("assignment-status", "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e21\u0e2d\u0e1a\u0e2b\u0e21\u0e32\u0e22\u0e07\u0e32\u0e19...", "loading");
  const result = await api(`/api/items/${state.itemId}/article-editorial-assignments`, {
    method: "POST",
    body: JSON.stringify({
      assignee_user_id: assigneeId || null,
      assignee_name: assigneeId ? null : externalName,
      assignee_contact: assigneeId ? null : externalContact,
      due_at: qs("editor-assignee-due-at")?.value || null,
      internal_note: qs("editor-assignee-note")?.value || null,
      replace_active: true,
    }),
  });
  state.articleProcess = result?.article_process || state.articleProcess;
  state.processByItemId[state.itemId] = state.articleProcess;
  state.items = await api("/api/items");
  state.item = await api(`/api/items/${state.itemId}`);
  await prefetchProcessSummaries();
  renderAll();
  setInlineStatus("assignment-status", "มอบหมายงานเขียนแล้ว");
}

function renderAll() {
  applyEditorWorkerView();
  const backHomeBtn = qs("btn-back-home");
  if (backHomeBtn) backHomeBtn.textContent = "โฮม";
  const openWorkspaceBtn = qs("btn-open-selected-workspace");
  if (openWorkspaceBtn) openWorkspaceBtn.textContent = "เปิดหน้าทำงาน";
  renderProcessBar();
  renderQueue();
  renderStatusSummary();
  renderAssignmentControls();
  renderActivityLog();
  applyActionGuards();
}

function wire() {
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-selected-workspace")?.addEventListener("click", () => {
    if (!state.itemId) return;
    const item = queueRows().find((row) => Number(row?.id || 0) === Number(state.itemId || 0)) || null;
    window.location.href = item ? primaryEntryUrl(item) : workspaceUrl();
  });
  qs("btn-assign-editor")?.addEventListener("click", async () => {
    try {
      state.busy = true;
      applyActionGuards();
      await assignEditor();
    } catch (error) {
      setInlineStatus("assignment-status", error.message, "error");
    } finally {
      state.busy = false;
      applyActionGuards();
    }
  });
}

(async function main() {
  try {
    wire();
    setBanner("กำลังโหลดคิวรับงานบทความ...", "loading");
    await loadIntake();
    renderAll();
    await hydrateIntakeDetails();
    renderAll();
    setBanner("");
    void runBackgroundDirectorySyncIfStale();
  } catch (error) {
    setBanner(error.message || "ไม่สามารถโหลดหน้ารับงานบทความได้", "error");
  }
})();



