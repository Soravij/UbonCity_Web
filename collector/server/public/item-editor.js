const token = sessionStorage.getItem("collector_token") || localStorage.getItem("collector_token") || "";
const AUTH_RETURN_TO_KEY = "collector_return_to";
const state = {
  token,
  user: null,
  itemId: Number(new URLSearchParams(window.location.search).get("id") || 0),
  item: null,
  imageWorkflow: null,
  assets: [],
  evidenceBlocks: [],
  approvedContextBlocks: [],
  draftInputPreview: null,
  fieldPack: null,
  itemAssignments: [],
  itemAssignmentsLoadFailed: false,
  evidenceView: {
    blockType: "all",
    sourceFamily: "all",
    sort: "source_priority",
  },
  pageBusy: false,
  busyButtons: [],
};

const isCleanMode = /\/clean-item\.html$/i.test(String(window.location.pathname || ""));

function getItemWorkflowCompatStatus(item) {
  const productionState = String(item?.production_state || "").trim().toLowerCase();
  const publicationState = String(item?.publication_state || "").trim().toLowerCase();
  if (publicationState === "published") return "published";
  if (publicationState === "approved" || publicationState === "unpublished" || productionState === "ready_for_publish") return "approved";
  if (productionState === "in_review") return "in_review";
  if (productionState === "needs_revision") return "needs_revision";
  if (productionState === "rejected") return "rejected";
  if (productionState === "content_in_progress") return "content_in_progress";
  if (productionState === "generated") return "generated";
  if (productionState === "ready_for_content") return "ready_for_content";
  if (productionState === "brief_generated") return "brief_generated";
  if (productionState === "analyzed") return "cleaned";
  if (productionState === "collected") return "raw";
  return "raw";
}

function isStepFourEligibleItem(item) {
  if (!item || typeof item !== "object") return false;
  const productionState = String(item?.production_state || "").trim().toLowerCase();
  const currentFieldPackId = Number(item?.current_field_pack_id || item?.field_pack_id || 0) || 0;
  if (currentFieldPackId > 0) return true;
  return (
    productionState === "generated"
    || productionState === "in_review"
    || productionState === "needs_revision"
    || productionState === "content_in_progress"
    || productionState === "ready_for_publish"
    || productionState === "completed"
  );
}

function canClaimCurrentItem() {
  const role = String(state.user?.role || "").toLowerCase();
  if (role !== "owner" && role !== "admin" && role !== "user") return false;
  return Number(state.item?.claimed_by_user_id || 0) === 0;
}

function canReleaseCurrentItem() {
  const role = String(state.user?.role || "").toLowerCase();
  if (role !== "owner" && role !== "admin" && role !== "user") return false;
  const claimedByUserId = Number(state.item?.claimed_by_user_id || 0) || 0;
  return claimedByUserId > 0 && claimedByUserId === Number(state.user?.id || 0);
}

function canTakeOverCurrentItem() {
  if (!isAdminUser()) return false;
  const claimedByUserId = Number(state.item?.claimed_by_user_id || 0) || 0;
  if (!claimedByUserId || claimedByUserId === Number(state.user?.id || 0)) return false;
  const actorRole = String(state.user?.role || "").trim().toLowerCase();
  const claimantRole = String(state.item?.claimed_by_user?.role || "").trim().toLowerCase();
  const getRoleRank = (role) => role === "owner" ? 3 : role === "admin" ? 2 : role === "user" ? 1 : 0;
  return getRoleRank(actorRole) > getRoleRank(claimantRole);
}

function getItemClaimHolderLabel(item = state.item) {
  const claimedBy = item?.claimed_by_user || null;
  if (claimedBy) {
    return String(claimedBy.display_name || claimedBy.email || `user #${Number(claimedBy.id || 0)}`).trim();
  }
  const claimedByUserId = Number(item?.claimed_by_user_id || 0) || 0;
  return claimedByUserId ? `user #${claimedByUserId}` : "";
}

function getItemAssignmentOwnerLabel(item = state.item) {
  const assignee = item?.assignment_owner?.assignee || null;
  if (assignee) {
    return String(assignee.display_name || assignee.email || `user #${Number(assignee.id || 0)}`).trim();
  }
  return "";
}

function getItemAssignedByLabel(item = state.item) {
  const assignedBy = item?.assignment_owner?.assigned_by || null;
  if (assignedBy) {
    return String(assignedBy.display_name || assignedBy.email || `user #${Number(assignedBy.id || 0)}`).trim();
  }
  return "";
}

function getViewerScopeReasonLabel(item = state.item) {
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

function canEditCurrentItem() {
  const role = String(state.user?.role || "").toLowerCase();
  if (role !== "owner" && role !== "admin" && role !== "user") return false;
  return Number(state.item?.claimed_by_user_id || 0) > 0 && Number(state.item?.claimed_by_user_id || 0) === Number(state.user?.id || 0);
}

function getEditPermissionGuard() {
  const role = String(state.user?.role || "").toLowerCase();
  if (role !== "owner" && role !== "admin" && role !== "user") {
    return { allowed: false, reason: "สิทธิ์ของ role นี้ไม่อนุญาตให้แก้ไขรายการ" };
  }
  const claimedByUserId = Number(state.item?.claimed_by_user_id || 0) || 0;
  if (!claimedByUserId) {
    return { allowed: false, reason: "รายการนี้ยังไม่ได้ถูก claim โดยผู้ใช้งาน" };
  }
  if (claimedByUserId !== Number(state.user?.id || 0)) {
    const holderLabel = getItemClaimHolderLabel();
    return {
      allowed: false,
      reason: holderLabel ? `รายการนี้ถูก claim โดย ${holderLabel} อยู่` : "รายการนี้ถูก claim โดยผู้ใช้อื่นอยู่",
    };
  }
  return { allowed: true, reason: "" };
}

function normalizeEditorWorkflowStage(workflowStatus) {
  const status = String(workflowStatus || "").trim().toLowerCase();
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
  return "raw";
}

function getEditorAssignmentGuard() {
  const fieldPackStatus = String(qs("fp-status")?.value || state.fieldPack?.status || "draft").trim().toLowerCase();
  if (!isFieldPackReadyForAssignment(fieldPackStatus)) {
    return {
      allowed: false,
      reason: fieldPackStatus === "on_hold"
        ? "ยังส่งมอบงานไม่ได้: field pack ถูกพักไว้"
        : "ยังส่งมอบงานไม่ได้: ต้องส่งต่อบทความไปขั้น \"ส่งต่อ handoff\" ก่อน",
    };
  }
  return {
    allowed: true,
    reason: "",
  };
}

function applyEditorActionGuards() {
  const editGuard = getEditPermissionGuard();
  setPreparationEditingDisabled(!editGuard.allowed);
  renderItemClaimBanner();
  const saveBtn = qs("btn-save");
  if (saveBtn) {
    saveBtn.disabled = !editGuard.allowed;
    saveBtn.title = editGuard.allowed ? "" : editGuard.reason;
  }
  const saveAiContextBtn = qs("btn-save-ai-context");
  if (saveAiContextBtn) {
    saveAiContextBtn.disabled = saveBtn ? saveBtn.disabled : !editGuard.allowed;
    saveAiContextBtn.title = saveBtn ? String(saveBtn.title || "") : (editGuard.allowed ? "" : editGuard.reason);
  }
  if (isCleanMode) {
    const nextAiBtn = qs("btn-next-ai");
    const runAiBtn = qs("btn-run-ai-context");
    const uploadBtn = qs("btn-upload-asset");
    const registerBtn = qs("btn-register-asset");
    const addEvidenceBtn = qs("btn-add-evidence");
    const addEvidenceAdvancedBtn = qs("btn-add-evidence-advanced");
    const canRunCleanActions = editGuard.allowed;

    if (nextAiBtn && !canRunCleanActions) {
      nextAiBtn.disabled = true;
      nextAiBtn.title = editGuard.reason;
    }
    if (runAiBtn && !canRunCleanActions) {
      runAiBtn.disabled = true;
      runAiBtn.title = editGuard.reason;
    }
    if (uploadBtn) {
      uploadBtn.disabled = !canRunCleanActions;
      uploadBtn.title = canRunCleanActions ? "" : editGuard.reason;
    }
    if (registerBtn) {
      registerBtn.disabled = !canRunCleanActions;
      registerBtn.title = canRunCleanActions ? "" : editGuard.reason;
    }
    if (addEvidenceBtn) {
      addEvidenceBtn.disabled = !canRunCleanActions;
      addEvidenceBtn.title = canRunCleanActions ? "" : editGuard.reason;
    }
    if (addEvidenceAdvancedBtn) {
      addEvidenceAdvancedBtn.disabled = !canRunCleanActions;
      addEvidenceAdvancedBtn.title = canRunCleanActions ? "" : editGuard.reason;
    }
    renderFieldProgressControl();
    return;
  }

  const btn = qs("btn-next-export");
  if (btn) {
    const guard = getEditorAssignmentGuard();
    const blockedReason = !editGuard.allowed ? editGuard.reason : guard.reason;
    btn.disabled = !editGuard.allowed || !guard.allowed;
    btn.title = btn.disabled ? blockedReason : "";
  }
  renderFieldProgressControl();
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

function sanitizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (raw.startsWith("/")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/\s/.test(raw)) return "";
  if (/^(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[\/?#].*)?$/i.test(raw)) {
    return `https://${raw.replace(/^\/+/, "")}`;
  }
  return "";
}

function sanitizeRelativeReturnTo(value) {
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "";
  return raw;
}

function parsePositiveInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function rolePortalUrl(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "editor") return "/editor-home.html";
  if (normalizedRole === "freelance") return "/freelance-home.html";
  return "/";
}

function buildFreelanceWorkUrl(itemId, assignmentId) {
  const params = new URLSearchParams();
  params.set("tab", "work");
  const normalizedItemId = parsePositiveInt(itemId);
  const normalizedAssignmentId = parsePositiveInt(assignmentId);
  if (normalizedItemId > 0) params.set("item_id", String(normalizedItemId));
  if (normalizedAssignmentId > 0) params.set("assignment_id", String(normalizedAssignmentId));
  return `/?${params.toString()}`;
}

async function resolveFreelanceEditorExitUrl() {
  const itemId = parsePositiveInt(state.itemId);
  if (!itemId) return buildFreelanceWorkUrl(0, 0);
  try {
    const response = await api("/api/assignments/mine?limit=100");
    const rows = Array.isArray(response?.assignments) ? response.assignments : [];
    const match = rows.find((row) => parsePositiveInt(row?.content_item_id) === itemId);
    if (match) {
      return buildFreelanceWorkUrl(itemId, parsePositiveInt(match.id));
    }
  } catch {
    // fall through to generic freelance landing when assignment lookup is unavailable
  }
  return buildFreelanceWorkUrl(itemId, 0);
}

async function getBackNavigationUrl() {
  const role = String(state.user?.role || "").trim().toLowerCase();
  if (role === "freelance") {
    return resolveFreelanceEditorExitUrl();
  }
  return rolePortalUrl(role);
}

function getCurrentReturnToPath() {
  return sanitizeRelativeReturnTo(`${window.location.pathname || "/"}${window.location.search || ""}`);
}

function redirectToLoginWithReturnTo(target = getCurrentReturnToPath()) {
  const safeTarget = sanitizeRelativeReturnTo(target);
  try {
    if (safeTarget) sessionStorage.setItem(AUTH_RETURN_TO_KEY, safeTarget);
  } catch {
    // ignore storage failures
  }
  const params = new URLSearchParams();
  if (safeTarget) params.set("return_to", safeTarget);
  const query = params.toString();
  window.location.assign(`/${query ? `?${query}` : ""}`);
}

function setImageWithFallback(img, url, onError = null) {
  if (!img) return;
  const safeUrl = sanitizeUrl(url);
  img.classList.remove("is-broken");
  if (!safeUrl) {
    img.removeAttribute("src");
    return;
  }
  img.onerror = () => {
    img.classList.add("is-broken");
    if (typeof onError === "function") onError();
  };
  img.onload = () => {
    img.classList.remove("is-broken");
  };
  img.src = safeUrl;
}
function setPageBusy(isBusy, message = "") {
  const allButtons = Array.from(document.querySelectorAll("button"));
  if (isBusy) {
    if (state.pageBusy) return;
    state.pageBusy = true;
    state.busyButtons = allButtons
      .filter((btn) => !btn.disabled)
      .map((btn) => {
        btn.disabled = true;
        btn.classList.add("is-loading");
        return btn;
      });
    if (message) setStatus(message);
    return;
  }

  state.pageBusy = false;
  (state.busyButtons || []).forEach((btn) => {
    btn.disabled = false;
    btn.classList.remove("is-loading");
  });
  state.busyButtons = [];
}

async function runWithPageBusy(message, action) {
  if (state.pageBusy) return null;
  setPageBusy(true, message);
  try {
    return await action();
  } finally {
    setPageBusy(false);
  }
}

function ensureAssetHoverPreview() {
  let box = document.getElementById("asset-hover-preview");
  if (box) return box;

  box = document.createElement("div");
  box.id = "asset-hover-preview";
  box.className = "asset-hover-preview hidden";
  box.innerHTML = '<img alt="asset preview" loading="lazy" />';
  document.body.appendChild(box);
  return box;
}

function positionAssetHoverPreview(box, event) {
  if (!box || !event) return;
  const gap = 14;
  const maxLeft = Math.max(12, window.innerWidth - box.offsetWidth - 12);
  const maxTop = Math.max(12, window.innerHeight - box.offsetHeight - 12);
  const left = Math.min(maxLeft, event.clientX + gap);
  const top = Math.min(maxTop, event.clientY + gap);
  box.style.left = `${Math.max(12, left)}px`;
  box.style.top = `${Math.max(12, top)}px`;
}

function showAssetHoverPreview(url, event) {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) return;
  const box = ensureAssetHoverPreview();
  const img = box.querySelector("img");
  if (!img) return;
  img.src = safeUrl;
  box.classList.remove("hidden");
  positionAssetHoverPreview(box, event);
}

function hideAssetHoverPreview() {
  const box = document.getElementById("asset-hover-preview");
  if (!box) return;
  box.classList.add("hidden");
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "คำขอไม่สำเร็จ" }));
    // Keep editor pages in-place on auth failures.
    // Auto-redirect here can bounce between return_to and home, which turns into
    // repeated document requests and eventually hits the rate limiter.
    throw new Error(data.error || "เกิดข้อผิดพลาด");
  }

  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("application/json") ? res.json() : null;
}

function isAdminUser() {
  const role = String(state.user?.role || "").toLowerCase();
  return role === "admin" || role === "owner";
}

function isOwnerUser() {
  return String(state.user?.role || "").toLowerCase() === "owner";
}

function setPreparationEditingDisabled(disabled) {
  const editableNodes = document.querySelectorAll("input, textarea, select");
  const keepEnabledIds = new Set([
    "evidence-filter-block-type",
    "evidence-filter-source-family",
    "evidence-sort",
  ]);
  editableNodes.forEach((node) => {
    if (node.hasAttribute("readonly") || String(node.type || "").toLowerCase() === "hidden") return;
    if (keepEnabledIds.has(String(node.id || "").trim())) return;
    node.disabled = Boolean(disabled);
  });
}


function renderItemClaimBanner() {
  const banner = qs("item-claim-banner");
  const statusNode = qs("item-claim-status");
  const claimBtn = qs("btn-item-claim");
  const releaseBtn = qs("btn-item-release");
  const takeoverBtn = qs("btn-item-takeover");
  if (!banner || !statusNode) return;

  const role = String(state.user?.role || "").toLowerCase();
  const holderLabel = getItemClaimHolderLabel();
  const assigneeLabel = getItemAssignmentOwnerLabel();
  const assignedByLabel = getItemAssignedByLabel();
  const scopeState = String(state.item?.item_work_scope_state || "").trim().toLowerCase();
  const scopeReasonLabel = getViewerScopeReasonLabel();
  const claimedAt = String(state.item?.claimed_at || "").trim();
  const claimedSuffix = claimedAt ? ` | claimed at ${claimedAt}` : "";
  const chips = [];

  if (canEditCurrentItem()) {
    chips.push(`<span class="intake-chip">Claimed by ${escapeHtml(holderLabel || "you")} / รับงานโดย ${escapeHtml(holderLabel || "you")}${escapeHtml(claimedSuffix)}</span>`);
    if (assigneeLabel) chips.push(`<span class="intake-chip">Assigned to ${escapeHtml(assigneeLabel)} / มอบหมายให้ ${escapeHtml(assigneeLabel)}</span>`);
    if (assignedByLabel) chips.push(`<span class="intake-chip">Assigned by ${escapeHtml(assignedByLabel)} / ผู้มอบหมาย ${escapeHtml(assignedByLabel)}</span>`);
    chips.push(`<span class="intake-chip">Visible because: ${escapeHtml(scopeReasonLabel)}</span>`);
  } else if (canClaimCurrentItem()) {
    chips.push('<span class="intake-chip">Raw pool / ยังไม่มีผู้รับงาน</span>');
    chips.push(`<span class="intake-chip">Visible because: ${escapeHtml(scopeReasonLabel)}</span>`);
  } else if (Number(state.item?.claimed_by_user_id || 0) > 0) {
    chips.push(holderLabel
      ? `<span class="intake-chip">Claimed by ${escapeHtml(holderLabel)} / รับงานโดย ${escapeHtml(holderLabel)}${escapeHtml(claimedSuffix)}</span>`
      : `<span class="intake-chip">Claimed by another user / รับงานโดยผู้ใช้อื่น${escapeHtml(claimedSuffix)}</span>`);
    if ((scopeState === "assigned" || scopeState === "claimed_and_assigned") && assigneeLabel) {
      chips.push(`<span class="intake-chip">Assigned to ${escapeHtml(assigneeLabel)} / มอบหมายให้ ${escapeHtml(assigneeLabel)}</span>`);
    }
    if ((scopeState === "assigned" || scopeState === "claimed_and_assigned") && assignedByLabel) {
      chips.push(`<span class="intake-chip">Assigned by ${escapeHtml(assignedByLabel)} / ผู้มอบหมาย ${escapeHtml(assignedByLabel)}</span>`);
    }
    chips.push(`<span class="intake-chip">Visible because: ${escapeHtml(scopeReasonLabel)}</span>`);
  } else {
    chips.push(`<span class="intake-chip">Visible because: ${escapeHtml(scopeReasonLabel)}</span>`);
  }
  statusNode.innerHTML = `<span class="intake-chip-row">${chips.join("")}</span>`;

  if (claimBtn) claimBtn.classList.toggle("hidden", !canClaimCurrentItem());
  if (releaseBtn) releaseBtn.classList.toggle("hidden", !canReleaseCurrentItem());
  if (takeoverBtn) takeoverBtn.classList.toggle("hidden", !canTakeOverCurrentItem());
}

function setStatus(text, isError = false) {
  const node = qs("editor-status");
  const mirrorNode = qs("draft-preview-status");
  const message = text || "";
  const color = isError ? "#b42318" : "#1f8a52";
  if (node) {
    node.textContent = message;
    node.style.color = color;
  }
  if (mirrorNode) {
    mirrorNode.textContent = message;
    mirrorNode.style.color = color;
  }
}

function setAssetStatus(text, isError = false) {
  const node = qs("asset-status");
  if (!node) return;
  node.textContent = text || "";
  node.style.color = isError ? "#b42318" : "#1f8a52";
}
function setEvidenceStatus(text, isError = false) {
  const node = qs("evidence-status");
  if (!node) return;
  node.textContent = text || "";
  node.style.color = isError ? "#b42318" : "#1f8a52";
}

function setContextStatus(text, isError = false) {
  const node = qs("context-status");
  if (!node) return;
  node.textContent = text || "";
  node.style.color = isError ? "#b42318" : "#1f8a52";
}

function setDraftPreviewStatus(text, isError = false) {
  const node = qs("draft-preview-status");
  if (!node) return;
  node.textContent = text || "";
  node.style.color = isError ? "#b42318" : "#1f8a52";
}
function setFieldPackRegenerateStatus(text, isError = false) {
  const node = qs("fp-regenerate-status");
  if (!node) return;
  node.textContent = text || "";
  node.style.color = isError ? "#b42318" : "#1f8a52";
}
async function withButtonLoading(btn, pendingLabel, action) {
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

function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseLineList(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeCaptureType(value, fallback = "photo") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "photo" || normalized === "video" || normalized === "both") return normalized;
  return fallback;
}

function explodeBothCaptureRow(baseRow = {}, index = 0) {
  const itemText = String(baseRow?.item_text || "").trim();
  if (!itemText) return [];
  const captureType = normalizeCaptureType(baseRow?.capture_type, "photo");
  const itemOrderBase = Number.isFinite(Number(baseRow?.item_order)) ? Number(baseRow.item_order) : index;
  const status = String(baseRow?.status || "todo").trim() || "todo";
  const note = baseRow?.note == null ? null : String(baseRow.note || "").trim() || null;

  if (captureType === "both") {
    return [
      { item_text: itemText, capture_type: "photo", item_order: itemOrderBase * 10, status, note },
      { item_text: itemText, capture_type: "video", item_order: itemOrderBase * 10 + 1, status, note },
    ];
  }
  return [{ item_text: itemText, capture_type: captureType, item_order: itemOrderBase * 10, status, note }];
}

function buildMustCaptureEditorRowsFromChecklists(checklists = [], fallbackLines = []) {
  const rows = (Array.isArray(checklists) ? checklists : [])
    .filter((row) => {
      const type = String(row?.checklist_type || "").trim().toLowerCase();
      return type === "must_capture" || type === "must_capture_shot";
    })
    .flatMap((row, index) => explodeBothCaptureRow({
      item_text: String(row?.item_text || "").trim(),
      capture_type: normalizeCaptureType(
        row?.capture_type,
        String(row?.checklist_type || "").trim().toLowerCase() === "must_capture_shot" ? "both" : "photo"
      ),
      item_order: Number.isFinite(Number(row?.item_order)) ? Number(row.item_order) : index,
      status: String(row?.status || "todo").trim() || "todo",
      note: row?.note == null ? null : String(row.note || "").trim() || null,
    }, index));

  if (rows.length) {
    return rows.sort((a, b) => Number(a.item_order || 0) - Number(b.item_order || 0));
  }

  return (Array.isArray(fallbackLines) ? fallbackLines : [])
    .flatMap((line, index) => explodeBothCaptureRow({
      item_text: String(line || "").trim(),
      capture_type: "both",
      item_order: index,
      status: "todo",
      note: null,
    }, index))
    .filter((row) => row.item_text);
}

function buildMustCaptureEditorRowsFromCards(items = []) {
  return (Array.isArray(items) ? items : [])
    .flatMap((text, index) => explodeBothCaptureRow({
      item_text: String(text || "").trim(),
      capture_type: "both",
      item_order: index,
      status: "todo",
      note: null,
    }, index))
    .filter((row) => row.item_text);
}

function formatMustCaptureDisplayItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((row) => {
      const itemText = String(row?.item_text || row || "").trim();
      if (!itemText) return "";
      const captureType = normalizeCaptureType(row?.capture_type, "both");
      return `[${captureType}] ${itemText}`;
    })
    .filter(Boolean);
}

function ensureMustCaptureEditor() {
  const source = qs("fp-must-capture-shots");
  if (!source) return null;
  source.style.display = "none";
  source.setAttribute("aria-hidden", "true");
  source.dataset.mustCaptureSource = "1";
  let root = qs("fp-must-capture-editor");
  if (!root) {
    root = document.createElement("div");
    root.id = "fp-must-capture-editor";
    root.className = "must-capture-editor";
    source.insertAdjacentElement("afterend", root);
  }
  return root;
}

function getMustCaptureAddDraft() {
  const type = normalizeCaptureType(qs("must-capture-add-type")?.value, "photo");
  const text = String(qs("must-capture-add-text")?.value || "").trim();
  return { type, text };
}

function syncMustCaptureEditorShadowValue() {
  const rows = getMustCaptureEditorRows();
  const source = qs("fp-must-capture-shots");
  if (!source) return;
  source.value = rows.map((row) => `[${row.capture_type}] ${row.item_text}`).join("\n");
}

function getMustCaptureEditorRows() {
  const root = qs("fp-must-capture-editor");
  if (!root) return [];
  return Array.from(root.querySelectorAll(".must-capture-row"))
    .map((row, index) => ({
      checklist_type: "must_capture",
      item_text: String(row.querySelector(".must-capture-item-text")?.value || "").trim(),
      capture_type: normalizeCaptureType(row.getAttribute("data-capture-type"), "photo"),
      item_order: index,
      status: String(row.dataset.status || "todo").trim() || "todo",
      note: String(row.dataset.note || "").trim() || null,
    }))
    .filter((row) => row.item_text);
}

function renderMustCaptureEditor(items = []) {
  const root = ensureMustCaptureEditor();
  if (!root) return;
  const rows = (Array.isArray(items) ? items : [])
    .map((row, index) => ({
      item_text: String(row?.item_text || "").trim(),
      capture_type: normalizeCaptureType(row?.capture_type, "photo"),
      item_order: Number.isFinite(Number(row?.item_order)) ? Number(row.item_order) : index,
      status: String(row?.status || "todo").trim() || "todo",
      note: row?.note == null ? null : String(row.note || "").trim() || null,
    }))
    .filter((row) => row.item_text)
    .sort((a, b) => Number(a.item_order || 0) - Number(b.item_order || 0));
  const photoRows = rows.filter((row) => row.capture_type === "photo");
  const videoRows = rows.filter((row) => row.capture_type === "video");
  const renderRow = (row, index, type) => `
    <div class="must-capture-row" data-capture-type="${escapeHtml(type)}" data-status="${escapeHtml(String(row.status || "todo"))}" data-note="${escapeHtml(String(row.note || ""))}">
      <span class="intake-badge ${type === "video" ? "priority-good" : "priority-top"}">${escapeHtml(type)}</span>
      <input class="must-capture-item-text" value="${escapeHtml(String(row.item_text || ""))}" placeholder="${type === "video" ? "อธิบายวิดีโอช็อตที่ถ่ายได้จริง 1 รายการ" : "อธิบายภาพช็อตที่ต้องถ่าย 1 รายการ"}" />
      <button type="button" class="utility-action must-capture-remove" aria-label="remove ${type} shot ${index + 1}">ลบ</button>
    </div>
  `;
  const draft = getMustCaptureAddDraft();
  root.innerHTML = `
    <div class="must-capture-grid">
      <div class="must-capture-column">
        <h4>Photo</h4>
        <div class="must-capture-list" data-capture-group="photo">
          ${photoRows.map((row, index) => renderRow(row, index, "photo")).join("") || '<p class="muted">ยังไม่มีรายการภาพ</p>'}
        </div>
      </div>
      <div class="must-capture-column">
        <h4>Video</h4>
        <div class="must-capture-list" data-capture-group="video">
          ${videoRows.map((row, index) => renderRow(row, index, "video")).join("") || '<p class="muted">ยังไม่มีรายการวิดีโอ</p>'}
        </div>
      </div>
    </div>
    <div class="must-capture-editor-toolbar">
      <div class="must-capture-add-row">
        <select id="must-capture-add-type" aria-label="เลือกประเภทช็อต">
          <option value="photo" ${draft.type === "photo" ? "selected" : ""}>photo</option>
          <option value="video" ${draft.type === "video" ? "selected" : ""}>video</option>
          <option value="both" ${draft.type === "both" ? "selected" : ""}>both</option>
        </select>
        <input id="must-capture-add-text" value="${escapeHtml(draft.text)}" placeholder="อธิบาย 1 ช็อตต่อ 1 รายการ" />
        <button type="button" class="utility-action" id="btn-must-capture-add">+ เพิ่มช็อต</button>
      </div>
      <span class="muted">ใช้ "both" เป็นทางลัดได้ ระบบจะแยกเป็นรายการภาพและวิดีโอให้โดยอัตโนมัติ</span>
    </div>
  `;
  syncMustCaptureEditorShadowValue();
}

function addMustCaptureEditorRow(defaultType = "photo", defaultText = "") {
  const existing = getMustCaptureEditorRows();
  const nextType = normalizeCaptureType(defaultType, "photo");
  const nextText = String(defaultText || "").trim();
  if (!nextText) {
    renderMustCaptureEditor(existing);
    return;
  }
  if (nextType === "both") {
    existing.push({ checklist_type: "must_capture", item_text: nextText, capture_type: "photo", item_order: existing.length, status: "todo", note: null });
    existing.push({ checklist_type: "must_capture", item_text: nextText, capture_type: "video", item_order: existing.length + 1, status: "todo", note: null });
  } else {
    existing.push({ checklist_type: "must_capture", item_text: nextText, capture_type: nextType, item_order: existing.length, status: "todo", note: null });
  }
  renderMustCaptureEditor(existing);
}

function setLineListValue(id, values = []) {
  const node = qs(id);
  if (!node) return;
  node.value = (Array.isArray(values) ? values : []).map((x) => String(x || "").trim()).filter(Boolean).join("\n");
}

const FIELD_PACK_FIXED_HEIGHT_TEXTAREA_IDS = new Set([
  "fp-references",
  "fp-writer-references",
  "fp-external-media-hints",
]);

function autosizeTextarea(node) {
  if (!(node instanceof HTMLTextAreaElement)) return;
  if (FIELD_PACK_FIXED_HEIGHT_TEXTAREA_IDS.has(node.id)) return;
  node.style.overflowY = "hidden";
  node.style.resize = "none";
  node.style.minHeight = "0px";
  node.style.height = "auto";
  node.style.height = `${node.scrollHeight}px`;
}

function autosizeFieldPackTextareas() {
  [
    "fp-ai-summary",
    "fp-ai-highlights",
    "fp-ai-unknowns",
    "fp-editor-summary",
    "fp-verified-facts",
    "fp-uncertain-facts",
    "fp-story-angle",
    "fp-field-notes",
    "fp-must-verify-facts",
    "fp-must-ask-questions",
    "fp-social-hook",
    "fp-social-shot-emphasis",
    "fp-social-on-camera-points",
    "fp-social-caption-angle",
    "fp-return-to-clean-note",
  ].forEach((id) => autosizeTextarea(qs(id)));
}

function listChecklistTexts(items = []) {
  return (Array.isArray(items) ? items : []).map((row) => String(row?.item_text || "").trim()).filter(Boolean);
}

function splitPipeParts(line) {
  return String(line || "").split("|").map((part) => String(part || "").trim());
}

function toDatetimeLocalValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseFieldPackReferencesFromText(value, scope = "general") {
  return parseLineList(value).map((line, index) => {
    const [label, url, sourceFamily = "manual", note = ""] = splitPipeParts(line);
    if (!label || !url) {
      throw new Error(`reference line ${index + 1} ต้องเป็นรูปแบบ label | url`);
    }
    return {
      reference_scope: scope,
      label,
      url,
      source_family: sourceFamily || "manual",
      note: note || null,
    };
  });
}

function formatReferenceLines(items = [], scope = "general") {
  return (Array.isArray(items) ? items : [])
    .filter((row) => String(row.reference_scope || "general") === scope)
    .map((row) => [
      String(row.label || "").trim(),
      String(row.url || "").trim(),
      String(row.source_family || "manual").trim(),
      String(row.note || "").trim(),
    ].filter((part, index) => index < 3 || part).join(" | "));
}

function parseExternalMediaHintLines(value) {
  return parseLineList(value).map((line, index) => {
    const [caption, url, kind = "reference"] = splitPipeParts(line);
    if (!url) {
      throw new Error(`external media hint line ${index + 1} ต้องเป็นรูปแบบ caption | url`);
    }
    return {
      content_asset_id: null,
      caption: caption || null,
      url,
      kind: kind || "reference",
      selected: true,
    };
  });
}

function formatExternalMediaHintLines(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((row) => !Number(row.content_asset_id || 0))
    .map((row) => [
      String(row.caption || "").trim(),
      String(row.url || "").trim(),
      String(row.kind || "reference").trim(),
    ].filter((part, index) => index < 2 || part).join(" | "));
}

function normalizeMediaHintPayloadUrl(rawUrl, contentAssetId = 0) {
  const text = String(rawUrl || "").trim();
  if (Number(contentAssetId || 0) > 0) return null;
  return text || null;
}

function buildAssignmentFormState(scope, assignments = []) {
  const row = (Array.isArray(assignments) ? assignments : []).find((item) => String(item.assignment_scope || "") === scope) || {};
  return {
    linked_assignment_id: Number(row.linked_assignment_id || 0) || 0,
    assigned_name: String(row.assigned_name || "").trim(),
    assigned_role: String(row.assigned_role || "").trim(),
    due_at: toDatetimeLocalValue(row.due_at),
    note: String(row.note || "").trim(),
  };
}

function preserveChecklistRows(existingItems = [], checklistType, nextTexts = []) {
  const pool = (Array.isArray(existingItems) ? existingItems : [])
    .filter((row) => String(row?.checklist_type || "") === checklistType)
    .map((row) => ({ ...row, item_text: String(row?.item_text || "").trim() }));
  const used = new Set();
  return (Array.isArray(nextTexts) ? nextTexts : []).map((itemText, index) => {
    const normalizedText = String(itemText || "").trim();
    const exactIndex = pool.findIndex((row, rowIndex) => !used.has(rowIndex) && row.item_text === normalizedText);
    const fallbackIndex = pool.findIndex((row, rowIndex) => !used.has(rowIndex) && Number(row.item_order) === index);
    const matchIndex = exactIndex >= 0 ? exactIndex : fallbackIndex;
    const match = matchIndex >= 0 ? pool[matchIndex] : null;
    if (matchIndex >= 0) used.add(matchIndex);
    const nextRow = {
      checklist_type: checklistType,
      item_text: normalizedText,
      item_order: index,
      status: String(match?.status || "todo").trim() || "todo",
      note: match?.note == null ? null : String(match.note || "").trim() || null,
    };
    if (checklistType === "must_capture") {
      const captureType = String(match?.capture_type || "").trim().toLowerCase();
      nextRow.capture_type = ["photo", "video", "both"].includes(captureType) ? captureType : "both";
    }
    return nextRow;
  });
}

function preserveAssignmentRow(existingAssignments = [], scope, formRow = {}) {
  const existing = (Array.isArray(existingAssignments) ? existingAssignments : [])
    .find((row) => String(row?.assignment_scope || "") === scope) || null;
  const hasVisibleValue = Boolean(
    Number(formRow?.linked_assignment_id || 0) ||
    String(formRow?.assigned_name || "").trim() ||
    String(formRow?.assigned_role || "").trim() ||
    String(formRow?.due_at || "").trim() ||
    String(formRow?.note || "").trim()
  );
  const hasHiddenExistingValue = Boolean(
    existing &&
    (
      Number(existing?.assigned_user_id || 0) ||
      String(existing?.assigned_at || "").trim()
    )
  );
  if (!hasVisibleValue && !hasHiddenExistingValue) return null;
  return {
    assignment_scope: scope,
    linked_assignment_id: hasVisibleValue ? (Number(formRow?.linked_assignment_id || 0) || null) : (Number(existing?.linked_assignment_id || 0) || null),
    assigned_user_id: existing?.assigned_user_id == null ? null : Number(existing.assigned_user_id || 0) || null,
    assigned_name: hasVisibleValue ? (String(formRow?.assigned_name || "").trim() || null) : (existing?.assigned_name ?? null),
    assigned_role: hasVisibleValue ? (String(formRow?.assigned_role || "").trim() || null) : (existing?.assigned_role ?? null),
    assigned_at: existing?.assigned_at || null,
    due_at: hasVisibleValue ? (String(formRow?.due_at || "").trim() || null) : (existing?.due_at ?? null),
    note: hasVisibleValue ? (String(formRow?.note || "").trim() || null) : (existing?.note ?? null),
  };
}

function preserveMediaHints(existingMediaHints = [], selectedMediaHints = [], externalMediaHints = [], renderedContentAssetIds = [], allowedContentAssetIds = []) {
  const renderedIds = new Set((Array.isArray(renderedContentAssetIds) ? renderedContentAssetIds : []).map((id) => Number(id || 0)).filter(Boolean));
  const allowedIds = new Set((Array.isArray(allowedContentAssetIds) ? allowedContentAssetIds : []).map((id) => Number(id || 0)).filter(Boolean));
  const preservedUnseen = (Array.isArray(existingMediaHints) ? existingMediaHints : [])
    .filter((row) => {
      const contentAssetId = Number(row?.content_asset_id || 0) || 0;
      return contentAssetId > 0 && !renderedIds.has(contentAssetId) && allowedIds.has(contentAssetId);
    })
    .map((row, index) => ({
      content_asset_id: Number(row.content_asset_id || 0) || null,
      url: normalizeMediaHintPayloadUrl(row.url, row.content_asset_id),
      kind: String(row.kind || "reference").trim() || "reference",
      caption: row.caption == null ? null : String(row.caption || "").trim() || null,
      selected: row.selected === false ? false : true,
      item_order: Number(row.item_order ?? index) || index,
    }));

  const selectedRows = (Array.isArray(selectedMediaHints) ? selectedMediaHints : []).map((row, index) => ({
    ...row,
    url: normalizeMediaHintPayloadUrl(row?.url, row?.content_asset_id),
    item_order: index,
  }));
  const externalRows = (Array.isArray(externalMediaHints) ? externalMediaHints : []).map((row, index) => ({
    ...row,
    content_asset_id: null,
    url: normalizeMediaHintPayloadUrl(row?.url, null),
    item_order: selectedRows.length + index,
  }));
  return [...selectedRows, ...externalRows, ...preservedUnseen];
}

function getActiveApprovedContextCount() {
  return (Array.isArray(state.approvedContextBlocks) ? state.approvedContextBlocks : []).filter((row) => String(row.status || "") === "active").length;
}

function hasApprovedContextForAgent() {
  return (Array.isArray(state.approvedContextBlocks) ? state.approvedContextBlocks : []).some((row) => {
    if (String(row?.status || "") !== "active") return false;
    const text = String(row?.selected_text || "").trim();
    const list = toDisplayList(row?.selected_list_json || row?.selected_list);
    return Boolean(text) || row?.selected_numeric != null || list.length > 0;
  });
}

function hasPlaceReferenceForAgent() {
  const sourceUrl = String(qs("e-source-url")?.value || state.item?.source_url || "").trim();
  const mapUrl = String(state.item?.map_url || "").trim();
  const googlePlaceId = String(state.item?.google_place_id || "").trim();
  const lat = String(qs("e-lat")?.value || state.item?.latitude || "").trim();
  const lng = String(qs("e-lng")?.value || state.item?.longitude || "").trim();
  return Boolean(sourceUrl || mapUrl || googlePlaceId || (lat && lng));
}

function getAgentBlockingMessages() {
  const title = String(qs("e-title")?.value || "").trim();
  const missing = [];
  if (!title) missing.push("title");
    if (!hasApprovedContextForAgent()) missing.push("approved_context");

  if (missing.length > 1) {
    return ["ยังส่งให้ Agent ไม่ได้: ข้อมูลสำคัญยังไม่ครบถ้วน"];
  }
  if (missing[0] === "title") {
    return ["ยังส่งให้ Agent ไม่ได้: ยังไม่ได้กรอกชื่อเรื่อง"];
  }
  if (missing[0] === "approved_context") {
    return ["ยังส่งให้ Agent ไม่ได้: ต้องมี approved context จาก Clean อย่างน้อย 1 จุด"];
  }
  return [];
}

function compactText(value, maxLen = 180) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, maxLen) + "...";
}

function compactUrl(value, maxLen = 80) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, maxLen) + "...";
}

function deriveHostName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return String(new URL(raw).hostname || "").trim().replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function getEvidenceSemanticDisplay(row = {}) {
  const blockType = String(row.block_type || "").trim().toLowerCase();
  const text = String(row.text_value || "").trim();
  const numericValue = row.numeric_value == null ? null : Number(row.numeric_value);
  if (blockType !== "social_proof") return null;

  if (/^review count signal$/i.test(text) && Number.isFinite(numericValue)) {
    return { typeLabel: "จำนวนรีวิว", primaryText: `${numericValue} รีวิว` };
  }

  if (/^rating signal$/i.test(text) && Number.isFinite(numericValue)) {
    return { typeLabel: "คะแนนเฉลี่ย", primaryText: `คะแนน ${numericValue}/5` };
  }

  if (/^(?:open now|open_now)\s*[:=]\s*(yes|true|open|1)\s*$/i.test(text)) {
    return { typeLabel: "สถานะเปิดปิด", primaryText: "เปิดอยู่ตอนนี้" };
  }
  if (/^(?:open now|open_now)\s*[:=]\s*(no|false|closed|0)\s*$/i.test(text)) {
    return { typeLabel: "สถานะเปิดปิด", primaryText: "ปิดอยู่ตอนนี้" };
  }

  const reviewCountMatch = text.match(/(?:review count|reviews?)\s*[:=]?\s*(\d[\d,]*)/i);
  if (reviewCountMatch) {
    const count = reviewCountMatch[1];
    return { typeLabel: "จำนวนรีวิว", primaryText: `${count} รีวิว` };
  }

  const ratingMatch = text.match(/rating\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (ratingMatch) {
    const rating = ratingMatch[1];
    return { typeLabel: "คะแนนเฉลี่ย", primaryText: `คะแนน ${rating}/5` };
  }

  if (Number.isFinite(numericValue)) {
    return { typeLabel: "ค่าตัวเลข", primaryText: `ค่า ${numericValue}` };
  }

  return { typeLabel: "ข้อความจากหลักฐาน", primaryText: text || "ไม่มีข้อความ" };
}

function toEvidenceBlockLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "fact") return "ข้อเท็จจริง";
  if (key === "mention") return "ข้อความอ้างอิง";
  if (key === "media") return "สื่อ";
  if (key === "review" || key === "review_snippet") return "รีวิว";
  if (key === "social_proof") return "หลักฐานโซเชียล";
  if (key === "editor_note") return "บันทึกบรรณาธิการ";
  if (key === "system_note") return "บันทึกระบบ";
  return String(value || "-").trim() || "-";
}

function toEvidenceStatusLabel(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "active") return "ใช้งานอยู่";
  if (key === "inactive") return "ปิดใช้";
  return String(value || "-").trim() || "-";
}

function isInternalAttributionText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /^Collected source signal$/i.test(text);
}

function formatEvidenceMeaningLabel(row = {}) {
  return String(getEvidenceSemanticDisplay(row)?.typeLabel || toEvidenceBlockLabel(row.block_type || "-")).trim() || "-";
}

function formatEvidencePrimaryValueText(row = {}) {
  const semantic = getEvidenceSemanticDisplay(row);
  if (semantic?.primaryText) return String(semantic.primaryText).trim();

  const rawText = String(row.text_value || "").trim();
  if (rawText && !isUrlLikeText(rawText)) return rawText;

  const listValue = toDisplayList(row.list_value_json);
  if (listValue.length) return listValue.map((x) => String(x)).join(", ");

  const numericValue = row.numeric_value == null ? null : Number(row.numeric_value);
  if (Number.isFinite(numericValue)) return String(numericValue);

  return "";
}

function formatEvidenceAttributionText(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^Collected source signal$/i.test(text)) {
    return "สัญญาณที่เก็บรวบรวมจากแหล่งข้อมูล";
  }
  return text;
}

function buildEvidenceSourceUrlHtml(url) {
  const sourceUrl = String(url || "").trim();
  if (!sourceUrl) return "ไม่มีข้อมูล";
  const host = deriveHostName(sourceUrl) || sourceUrl;
  return `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(host)}</a>`;
}

function isUrlLikeText(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function buildSourceOpenLink(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  return `<a class="source-open-link" href="${escapeHtml(text)}" target="_blank" rel="noopener">เปิด</a>`;
}

function classifyEvidenceSourceFamily(row = {}) {
  const backendFamily = String(row.source_family || "").trim().toLowerCase();
  if (backendFamily === "official") return { key: "official", label: "Official Web", priority: 1 };
  if (backendFamily === "institutional") return { key: "institutional", label: "หน่วยงานทางการ", priority: 1 };
  if (backendFamily === "google_maps") return { key: "google_maps", label: "Google Maps", priority: 2 };
  if (backendFamily === "google") return { key: "google", label: "Google", priority: 3 };
  if (backendFamily === "wongnai") return { key: "wongnai", label: "Wongnai", priority: 3 };
  if (backendFamily === "system") return { key: "system", label: "ระบบ", priority: 5 };
  if (backendFamily === "manual") return { key: "manual", label: "กำหนดเอง", priority: 4 };

  const sourceType = String(row.source_type || "").trim().toLowerCase();
  const host = deriveHostName(row.source_url || "");
  if (sourceType === "google_maps" || /^maps\.google\./i.test(host)) {
    return { key: "google_maps", label: "Google Maps", priority: 2 };
  }
  if (sourceType === "google" || /(?:^|\.)google\./i.test(host)) {
    return { key: "google", label: "Google", priority: 3 };
  }
  if (sourceType === "wongnai" || /(?:^|\.)wongnai\.com$/i.test(host)) {
    return { key: "wongnai", label: "Wongnai", priority: 3 };
  }
  if (/(\.go\.th|\.ac\.th|\.or\.th|\.gov|\.edu)$/i.test(host)) {
    return { key: "institutional", label: "หน่วยงานทางการ", priority: 1 };
  }
  if (sourceType === "official" || sourceType === "official_site") {
    return { key: "official", label: "Official Web", priority: 1 };
  }
  if (sourceType === "system" || sourceType === "collector" || sourceType === "import") {
    return { key: "system", label: "ระบบ", priority: 5 };
  }
  return { key: "manual", label: "กำหนดเอง", priority: 4 };
}

function parseReferenceSummaryLines(value) {
  return parseLineList(value)
    .map((line) => {
      const [label, url, sourceFamily = "manual", note = ""] = splitPipeParts(line);
      if (!url) return null;
      return {
        label: String(label || "").trim(),
        url: String(url || "").trim(),
        source_family: String(sourceFamily || "manual").trim(),
        note: String(note || "").trim(),
      };
    })
    .filter(Boolean);
}

function getReadableSourceShortLabel(row = {}) {
  const url = String(row.url || row.source_url || row.evidence_source_url || "").trim();
  const family = classifyEvidenceSourceFamily({
    source_family: row.source_family || row.evidence_source_family,
    source_type: row.source_type || row.evidence_source_type,
    source_url: url,
  });
  if (family.key === "google_maps" || family.key === "google" || family.key === "wongnai") {
    return family.label;
  }
  const host = deriveHostName(url);
  if (host) return host;
  if (family.key === "official" || family.key === "institutional") {
    return family.label;
  }
  const fallbackLabel = String(row.label || "").trim();
  if (fallbackLabel && !isUrlLikeText(fallbackLabel)) {
    return fallbackLabel;
  }
  return family.label;
}

function collectEditorReferenceSources() {
  const rows = [];
  if (!isCleanMode) {
    rows.push(...parseReferenceSummaryLines(qs("fp-references")?.value || ""));
    rows.push(...parseReferenceSummaryLines(qs("fp-writer-references")?.value || ""));
    if (!rows.length && Array.isArray(state.fieldPack?.references)) {
      rows.push(...state.fieldPack.references);
    }
  }
  if (!rows.length) {
    rows.push(
      ...(Array.isArray(state.approvedContextBlocks) ? state.approvedContextBlocks : []).map((row) => ({
        source_family: row.evidence_source_family,
        source_type: row.evidence_source_type,
        source_url: row.evidence_source_url,
      }))
    );
  }
  if (!rows.length) {
    rows.push(
      ...(Array.isArray(state.evidenceBlocks) ? state.evidenceBlocks : []).map((row) => ({
        source_family: row.source_family,
        source_type: row.source_type,
        source_url: row.source_url,
      }))
    );
  }
  if (!rows.length) {
    const legacySourceName = String(qs("e-source-name")?.value || state.item?.source_name || "").trim();
    const legacySourceUrl = String(qs("e-source-url")?.value || state.item?.source_url || "").trim();
    if (legacySourceName || legacySourceUrl) {
      rows.push({
        label: legacySourceName,
        url: legacySourceUrl,
        source_family: "manual",
      });
    }
  }
  return rows;
}

function buildEditorReferenceSourceSummary(maxVisible = 3) {
  const labels = [];
  const seen = new Set();
  for (const row of collectEditorReferenceSources()) {
    const label = getReadableSourceShortLabel(row);
    const key = String(label || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  const visible = labels.slice(0, maxVisible);
  return {
    labels,
    visible,
    extraCount: Math.max(0, labels.length - visible.length),
    summaryText: visible.length
      ? `${visible.join(", ")}${labels.length > visible.length ? ` +${labels.length - visible.length}` : ""}`
      : "ยังไม่พบแหล่งอ้างอิงที่สรุปได้",
  };
}

function buildEditorReferenceSourceLinks() {
  const rows = [];
  const seen = new Set();
  for (const row of collectEditorReferenceSources()) {
    const label = getReadableSourceShortLabel(row);
    const url = sanitizeUrl(String(row?.url || row?.source_url || "").trim());
    const key = `${String(label || "").trim().toLowerCase()}|${String(url || "").toLowerCase()}`;
    if (!label || seen.has(key)) continue;
    seen.add(key);
    rows.push({ label, url });
  }
  return rows;
}

function renderEditorReferenceSourceSummary() {
  const root = qs("editor-source-summary");
  if (!root || isCleanMode) return;
  const summary = buildEditorReferenceSourceSummary();
  if (!summary.labels.length) {
    root.innerHTML = '<p class="muted">ยังไม่มีข้อมูลแหล่งอ้างอิงจาก references หรือ evidence</p>';
    return;
  }
  root.innerHTML = `
    <div class="source-summary-list">
      ${summary.visible.map((label) => `<span class="source-summary-chip">${escapeHtml(label)}</span>`).join("")}
      ${summary.extraCount > 0 ? `<span class="source-summary-more">+${summary.extraCount}</span>` : ""}
    </div>
  `;
}

function evidenceSourceBadgeClass(familyKey = "") {
  if (familyKey === "official" || familyKey === "institutional") return "priority-top";
  if (familyKey === "google_maps") return "priority-good";
  if (familyKey === "wongnai") return "merge-near";
  if (familyKey === "manual") return "priority-check";
  return "priority-low";
}

function getEvidenceFilteredRows(rows = []) {
  const blockFilter = String(state.evidenceView?.blockType || "all").trim().toLowerCase();
  const sourceFilter = String(state.evidenceView?.sourceFamily || "all").trim().toLowerCase();
  const sortMode = String(state.evidenceView?.sort || "source_priority").trim().toLowerCase();
  const list = (Array.isArray(rows) ? rows : []).filter((row) => {
    const blockType = String(row?.block_type || "").trim().toLowerCase();
    const sourceFamily = classifyEvidenceSourceFamily(row).key;
    if (blockFilter !== "all" && blockType !== blockFilter) return false;
    if (sourceFilter !== "all" && sourceFamily !== sourceFilter) return false;
    return true;
  });

  list.sort((a, b) => {
    if (sortMode === "latest") return Number(b?.id || 0) - Number(a?.id || 0);
    if (sortMode === "oldest") return Number(a?.id || 0) - Number(b?.id || 0);
    if (sortMode === "block_type") {
      const blockCompare = String(a?.block_type || "").localeCompare(String(b?.block_type || ""), "th");
      if (blockCompare !== 0) return blockCompare;
      return Number(b?.id || 0) - Number(a?.id || 0);
    }
    const sourcePriorityDiff = classifyEvidenceSourceFamily(a).priority - classifyEvidenceSourceFamily(b).priority;
    if (sourcePriorityDiff !== 0) return sourcePriorityDiff;
    return Number(b?.id || 0) - Number(a?.id || 0);
  });

  return list;
}

function toDisplayList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function formatLongValue(value, emptyText = "ไม่มีข้อมูล") {
  const text = String(value || "").trim();
  return text || emptyText;
}

function openEvidenceValueModal(row) {
  const modal = qs("evidence-value-modal");
  const titleNode = qs("evidence-value-modal-title");
  const bodyNode = qs("evidence-value-modal-body");
  if (!modal || !titleNode || !bodyNode) return;

  const evidenceId = Number(row?.id || 0) || 0;
  const sourceUrl = String(row?.source_url || "").trim();
  const listValue = toDisplayList(row?.list_value_json);
  const listValueText = listValue.length ? listValue.map((x) => String(x)).join("\n") : "";
  const primaryValue = formatEvidencePrimaryValueText(row) || "ไม่มีข้อมูล";
  const meaningLabel = formatEvidenceMeaningLabel(row);
  const attributionText = formatEvidenceAttributionText(row?.attribution_text) || "ไม่มีข้อมูล";
  const rawTextValue = String(row?.text_value || "").trim() || "ไม่มีข้อมูล";
  const numericValue = row?.numeric_value == null ? "ไม่มีข้อมูล" : String(row.numeric_value);

  titleNode.textContent = evidenceId ? `ดู Evidence #${evidenceId}` : "ดู Evidence";
  bodyNode.innerHTML = `
    <section class="evidence-value-section">
      <h4>ความหมาย</h4>
      <pre>${escapeHtml(formatLongValue(meaningLabel))}</pre>
    </section>
    <section class="evidence-value-section">
      <h4>ค่า</h4>
      <pre>${escapeHtml(formatLongValue(primaryValue))}</pre>
    </section>
    <section class="evidence-value-section">
      <h4>ที่มา</h4>
      <pre>${escapeHtml(formatLongValue(attributionText))}</pre>
    </section>
    <section class="evidence-value-section">
      <h4>ลิงก์อ้างอิง</h4>
      <pre>${escapeHtml(formatLongValue(sourceUrl))}</pre>
    </section>
    <section class="evidence-value-section">
      <h4>ข้อมูลดิบ</h4>
      <pre>${escapeHtml(`text_value: ${formatLongValue(rawTextValue)}\nnumeric_value: ${formatLongValue(numericValue)}\nlist_value: ${formatLongValue(listValueText || "ไม่มีข้อมูล")}`)}</pre>
    </section>
  `;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  modal.dataset.evidenceId = evidenceId ? String(evidenceId) : "";
}

function closeEvidenceValueModal() {
  const modal = qs("evidence-value-modal");
  const bodyNode = qs("evidence-value-modal-body");
  if (!modal || !bodyNode) return;
  const evidenceId = Number(modal.dataset.evidenceId || 0);
  if (evidenceId) {
    const detail = document.querySelector(`tr[data-detail-for="evidence-${evidenceId}"]`);
    if (detail) detail.classList.add("hidden");
    const toggleBtn = document.querySelector(`button[data-action="toggle-evidence-details"][data-evidence-id="${evidenceId}"]`);
    if (toggleBtn) toggleBtn.textContent = "ดูรายละเอียด";
  }
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  modal.dataset.evidenceId = "";
  bodyNode.innerHTML = "";
}

function formatEvidenceSource(row) {
  const sourceUrl = String(row.source_url || "").trim();
  const family = classifyEvidenceSourceFamily(row);
  const domain = deriveHostName(sourceUrl) || "-";
  const domainHtml = sourceUrl
    ? `<a class="source-open-link source-domain-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(domain)}</a>`
    : `<span class="muted source-domain">${escapeHtml(domain)}</span>`;

  const pieces = [
    `<div class="intake-badges"><span class="intake-badge ${evidenceSourceBadgeClass(family.key)}">${escapeHtml(family.label)}</span></div>`,
    `<div class="source-main">${domainHtml}</div>`,
  ];
  return pieces.join("");
}

function formatEvidenceValue(row) {
  const family = classifyEvidenceSourceFamily(row);
  const blockType = String(row.block_type || "").trim().toLowerCase();
  const semantic = getEvidenceSemanticDisplay(row);
  const rawText = String(row.text_value || "").trim();
  const textValue = rawText && !isUrlLikeText(rawText) ? compactText(rawText, 150) : "";
  const numericValue = row.numeric_value == null ? null : Number(row.numeric_value);
  const listValue = toDisplayList(row.list_value_json);
  const pieces = [];

  if (semantic?.primaryText) {
    pieces.push(`<div>${escapeHtml(compactText(semantic.primaryText, 150))}</div>`);
  } else if (textValue) {
    pieces.push(`<div>${escapeHtml(textValue)}</div>`);
  } else if (blockType === "media") {
    pieces.push(`<div>อ้างอิงจาก ${escapeHtml(family.label)}</div>`);
  } else if (listValue.length) {
    pieces.push(`<div>${escapeHtml(compactText(listValue.map((x) => String(x)).join(", "), 150))}</div>`);
  } else if (Number.isFinite(numericValue)) {
    pieces.push(`<div>ค่าตัวเลข: ${escapeHtml(String(numericValue))}</div>`);
  } else {
    pieces.push('<div class="muted">ไม่มีข้อมูลสำหรับแสดง</div>');
  }

  if (Number.isFinite(numericValue)) {
    pieces.push(`<div class="muted">ค่าตัวเลข: ${escapeHtml(String(numericValue))}</div>`);
  }
  if (listValue.length && !textValue) {
    pieces.push(`<div class="muted">รายการ: ${escapeHtml(compactText(listValue.map((x) => String(x)).join(", "), 120))}</div>`);
  }
  const attribution = String(row.attribution_text || "").trim();
  if (attribution && !isInternalAttributionText(attribution)) {
    pieces.push(`<div class="muted">${escapeHtml(compactText(attribution, 80))}</div>`);
  }
  return pieces.join("");
}

function formatContextSelected(row) {
  const semantic = getEvidenceSemanticDisplay({
    block_type: row.context_type,
    text_value: row.selected_text,
    numeric_value: row.selected_numeric,
  });
  if (semantic?.primaryText) return semantic.primaryText;

  const selectedText = String(row.selected_text || "").trim();
  if (selectedText) return compactText(selectedText, 150);

  if (row.selected_numeric != null && Number.isFinite(Number(row.selected_numeric))) {
    return `ค่าตัวเลข: ${row.selected_numeric}`;
  }

  const selectedList = toDisplayList(row.selected_list_json);
  if (selectedList.length) {
    return compactText(selectedList.map((x) => String(x)).join(", "), 150);
  }

  return "-";
}

function formatContextProvenance(row) {
  const sourceRow = {
    source_family: row.evidence_source_family,
    source_type: row.evidence_source_type,
    source_url: row.evidence_source_url,
  };
  const family = classifyEvidenceSourceFamily(sourceRow);
  const sourceUrl = String(row.evidence_source_url || "").trim();
  const domain = deriveHostName(sourceUrl) || "-";
  const domainHtml = sourceUrl
    ? `<a class="source-open-link source-domain-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(domain)}</a>`
    : `<span class="muted source-domain">${escapeHtml(domain)}</span>`;
  const pieces = [
    `<div class="intake-badges"><span class="intake-badge ${evidenceSourceBadgeClass(family.key)}">${escapeHtml(family.label)}</span></div>`,
    `<div class="source-main">${domainHtml}</div>`,
  ];
  return pieces.join("");
}


function mapContextActionError(message, fallback) {
  const text = String(message || "").trim();
  if (/already exists for this evidence block/i.test(text)) {
    return "มี approved context แบบ active สำหรับ evidence นี้อยู่แล้ว";
  }
  if (text) return text;
  return fallback;
}
function normalizeGuardMessage(message) {
  const raw = String(message || "").trim();
  if (!raw) return "Validation failed";
  if (/[?]{3,}|\uFFFD/.test(raw)) return "Validation failed: message could not be decoded";
  if (/Need at least 1 approved context/i.test(raw)) return "Need at least 1 approved context";
  if (/Select at least 1 image/i.test(raw)) return "Select at least 1 image";
  if (/Set a cover image/i.test(raw)) return "Set a cover image";
  if (/approved context/i.test(raw)) return "Need at least 1 approved context";
  return raw;
}

function renderEvidenceTable() {
  const table = qs("table-evidence");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const rows = Array.isArray(state.evidenceBlocks) ? state.evidenceBlocks : [];
  const visibleRows = getEvidenceFilteredRows(rows);
  const canEdit = canEditCurrentItem();
  const contexts = Array.isArray(state.approvedContextBlocks) ? state.approvedContextBlocks : [];
  const activeByEvidence = new Map();
  for (const ctx of contexts) {
    if (String(ctx.status || "") === "active") {
      activeByEvidence.set(Number(ctx.evidence_block_id || 0), ctx);
    }
  }

  const summaryNode = qs("evidence-table-summary");
  if (summaryNode) {
    summaryNode.textContent = visibleRows.length === rows.length
      ? `แสดง ${visibleRows.length} evidence`
      : `แสดง ${visibleRows.length}/${rows.length} evidence`;
  }

  if (!visibleRows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="muted">${rows.length ? "ไม่พบ evidence ตามเงื่อนไขที่เลือก" : "ยังไม่มี evidence blocks"}</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const row of visibleRows) {
    const evidenceId = Number(row.id || 0);
    const activeCtx = activeByEvidence.get(evidenceId) || null;
    const action = !canEdit
      ? ""
      : activeCtx
        ? `<button data-action="unapprove" data-context-id="${Number(activeCtx.id) || 0}">ถอนจาก Agent</button>`
        : `<button data-action="approve" data-evidence-id="${evidenceId}">อนุมัติให้ Agent</button>`;

    const status = String(row.status || "active");
    const selectedBadge = activeCtx
      ? '<span class="workflow-badge workflow-badge-sent">ส่งให้ Agent</span>'
      : '<span class="muted">ยังไม่ถูกเลือกส่งให้ Agent</span>';
    const sourceUrl = String(row.source_url || "").trim();
    const sourceUrlHtml = sourceUrl
      ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(sourceUrl)}</a>`
      : "-";
    const listValue = toDisplayList(row.list_value_json);
    const listValueText = listValue.length ? listValue.map((x) => String(x)).join(", ") : "-";

    const tr = document.createElement("tr");
    tr.className = "clean-main-row";
    tr.innerHTML = `
      <td>${evidenceId}</td>
      <td>${escapeHtml(formatEvidenceMeaningLabel(row))}</td>
      <td class="evidence-source-cell">${formatEvidenceSource(row)}</td>
      <td class="evidence-value-cell">${formatEvidenceValue(row)}</td>
      <td>
        <span class="status-pill status-${escapeHtml(status)}">${escapeHtml(toEvidenceStatusLabel(status))}</span>
        <div class="table-substatus">${selectedBadge}</div>
      </td>
      <td>
        <div class="action-stack">
          ${action || ""}
          <button data-action="toggle-evidence-details" data-evidence-id="${evidenceId}">ดูรายละเอียด</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);

    const detail = document.createElement("tr");
    detail.className = "detail-row hidden";
    detail.setAttribute("data-detail-for", `evidence-${evidenceId}`);
    detail.innerHTML = `
      <td colspan="6">
        <div class="detail-panel">
          <div><strong>ความหมาย:</strong> ${escapeHtml(formatEvidenceMeaningLabel(row))}</div>
          <div><strong>ค่า:</strong> ${escapeHtml(formatEvidencePrimaryValueText(row) || "ไม่มีข้อมูล")}</div>
          <div><strong>ที่มา:</strong> ${escapeHtml(formatEvidenceAttributionText(row.attribution_text) || "ไม่มีข้อมูล")}</div>
          <div><strong>ลิงก์อ้างอิง:</strong> ${buildEvidenceSourceUrlHtml(sourceUrl)}</div>
          <div><strong>สถานะ:</strong> ${escapeHtml(toEvidenceStatusLabel(status))}</div>
          <div><strong>สถานะ Agent:</strong> ${activeCtx ? `ส่งแล้ว (context ${Number(activeCtx.id) || 0})` : "ยังไม่ส่ง"}</div>
          <div><strong>รายละเอียด:</strong> block_type=${escapeHtml(String(row.block_type || "-"))} | source_type=${escapeHtml(String(row.source_type || "-"))} | text_value=${escapeHtml(String(row.text_value || "ไม่มีข้อมูล"))} | numeric_value=${row.numeric_value == null ? "-" : escapeHtml(String(row.numeric_value))} | list_value=${escapeHtml(listValueText)}</div>
        </div>
      </td>
    `;
    tbody.appendChild(detail);
  }

  tbody.querySelectorAll("button[data-action='toggle-evidence-details']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const evidenceId = Number(btn.dataset.evidenceId || 0);
      if (!evidenceId) return;
      const row = rows.find((x) => Number(x.id || 0) === evidenceId);
      const detail = tbody.querySelector(`tr[data-detail-for="evidence-${evidenceId}"]`);
      if (!detail) return;
      const isHidden = detail.classList.contains("hidden");
      detail.classList.toggle("hidden", !isHidden);
      btn.textContent = isHidden ? "ซ่อนรายละเอียด" : "ดูรายละเอียด";
      if (isHidden) {
        if (row) openEvidenceValueModal(row);
      } else {
        const modal = qs("evidence-value-modal");
        if (modal && String(modal.dataset.evidenceId || "") === String(evidenceId)) {
          closeEvidenceValueModal();
        }
      }
    });
  });

  tbody.querySelectorAll("button[data-action='approve']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const evidenceId = Number(btn.dataset.evidenceId || 0);
      if (!evidenceId) return;
      const evidence = rows.find((x) => Number(x.id || 0) === evidenceId);
      if (!evidence) return;

      try {
        await withButtonLoading(btn, "กำลังอนุมัติ...", async () => {
          const payload = {
            evidence_block_id: evidenceId,
            context_type: evidence.block_type || "fact",
            selected_text: evidence.text_value || "",
            selected_numeric: evidence.numeric_value ?? null,
            selected_list: Array.isArray(evidence.list_value_json) ? evidence.list_value_json : [],
            note: "อนุมัติจากหน้า Clean",
            status: "active",
          };
          await api(`/api/items/${state.itemId}/approved-context`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
          await loadEvidenceContextAndPreview();
        });
        setContextStatus(`ส่ง evidence ${evidenceId} ให้ Agent แล้ว`);
      } catch (err) {
        setContextStatus(mapContextActionError(err.message, "อนุมัติให้ Agent ไม่สำเร็จ"), true);
      }
    });
  });

  tbody.querySelectorAll("button[data-action='unapprove']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const contextId = Number(btn.dataset.contextId || 0);
      if (!contextId) return;
      try {
        await withButtonLoading(btn, "กำลังถอน...", async () => {
          await api(`/api/items/${state.itemId}/approved-context/${contextId}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "inactive" }),
          });
          await loadEvidenceContextAndPreview();
        });
        setContextStatus(`ถอด context ${contextId} ออกจาก Agent แล้ว`);
      } catch (err) {
        setContextStatus(mapContextActionError(err.message, "ถอนจาก Agent ไม่สำเร็จ"), true);
      }
    });
  });
}
function renderApprovedContextTable() {
  const table = qs("table-approved-context");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const rows = Array.isArray(state.approvedContextBlocks) ? state.approvedContextBlocks : [];
  const canEdit = canEditCurrentItem();
  if (!rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td colspan="7" class="muted">ยังไม่มี approved context</td>';
    tbody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const status = String(row.status || "inactive");
    const action = !canEdit
      ? ""
      : status === "active"
        ? `<button data-action="deactivate" data-context-id="${Number(row.id) || 0}">ถอนจาก Agent</button>`
        : `<button data-action="activate" data-context-id="${Number(row.id) || 0}">เปิดใช้งานบริบท</button>`;
    const selectedList = toDisplayList(row.selected_list_json);
    const selectedListText = selectedList.length ? selectedList.map((x) => String(x)).join(", ") : "-";
    const sourceUrl = String(row.evidence_source_url || "").trim();
    const sourceUrlHtml = sourceUrl
      ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">${escapeHtml(sourceUrl)}</a>`
      : "-";

    const tr = document.createElement("tr");
    tr.className = "clean-main-row";
    tr.innerHTML = `
      <td>${Number(row.id) || 0}</td>
      <td>${Number(row.evidence_block_id) || 0}</td>
      <td>${escapeHtml(getEvidenceSemanticDisplay({
        block_type: row.context_type,
        text_value: row.selected_text,
        numeric_value: row.selected_numeric,
      })?.typeLabel || toEvidenceBlockLabel(row.context_type || "-"))}</td>
      <td>${escapeHtml(formatContextSelected(row))}</td>
      <td>${formatContextProvenance(row)}</td>
      <td><span class="status-pill status-${escapeHtml(status)}">${escapeHtml(toEvidenceStatusLabel(status))}</span></td>
      <td>
        <div class="action-stack">
          ${action || ""}
          <button data-action="toggle-context-details" data-context-id="${Number(row.id) || 0}">ดูรายละเอียด</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);

    const detail = document.createElement("tr");
    detail.className = "detail-row hidden";
    detail.setAttribute("data-detail-for", `context-${Number(row.id) || 0}`);
    detail.innerHTML = `
      <td colspan="7">
        <div class="detail-panel">
          <div><strong>context_type:</strong> ${escapeHtml(String(row.context_type || "-"))}</div>
          <div><strong>selected_text:</strong> ${escapeHtml(String(row.selected_text || "ไม่มีข้อมูล"))}</div>
          <div><strong>selected_numeric:</strong> ${row.selected_numeric == null ? "-" : escapeHtml(String(row.selected_numeric))}</div>
          <div><strong>selected_list_json:</strong> ${escapeHtml(selectedListText)}</div>
          <div><strong>evidence_block_id:</strong> ${Number(row.evidence_block_id) || 0}</div>
          <div><strong>provenance/source type:</strong> ${escapeHtml(String(row.evidence_source_type || "-"))}</div>
          <div><strong>provenance/source url:</strong> ${sourceUrlHtml}</div>
          <div><strong>status:</strong> ${escapeHtml(status)}</div>
        </div>
      </td>
    `;
    tbody.appendChild(detail);
  }

  tbody.querySelectorAll("button[data-action='toggle-context-details']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const contextId = Number(btn.dataset.contextId || 0);
      if (!contextId) return;
      const detail = tbody.querySelector(`tr[data-detail-for="context-${contextId}"]`);
      if (!detail) return;
      const isHidden = detail.classList.contains("hidden");
      detail.classList.toggle("hidden", !isHidden);
      btn.textContent = isHidden ? "ซ่อนรายละเอียด" : "ดูรายละเอียด";
    });
  });

  const patchStatus = async (contextId, status) => {
    await api(`/api/items/${state.itemId}/approved-context/${contextId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    await loadEvidenceContextAndPreview();
  };

  tbody.querySelectorAll("button[data-action='deactivate']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const contextId = Number(btn.dataset.contextId || 0);
      if (!contextId) return;
      try {
        await withButtonLoading(btn, "กำลังปิดใช้งาน...", async () => {
          await patchStatus(contextId, "inactive");
        });
        setContextStatus(`ปิด context ${contextId} จาก Agent input แล้ว`);
      } catch (err) {
        setContextStatus(mapContextActionError(err.message, "ปิดบริบทไม่สำเร็จ"), true);
      }
    });
  });

  tbody.querySelectorAll("button[data-action='activate']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const contextId = Number(btn.dataset.contextId || 0);
      if (!contextId) return;
      try {
        await withButtonLoading(btn, "กำลังเปิดใช้งาน...", async () => {
          await patchStatus(contextId, "active");
        });
        setContextStatus(`เปิด context ${contextId} ให้ใช้งานแล้ว`);
      } catch (err) {
        setContextStatus(mapContextActionError(err.message, "เปิดบริบทไม่สำเร็จ"), true);
      }
    });
  });
}
function renderDraftInputPreviewPanel() {
  const node = qs("draft-input-preview");
  const readableNode = qs("draft-input-preview-readable");
  if (!node) return;
  const payload = state.draftInputPreview || { approved_context: [] };
  const blocks = Array.isArray(payload.approved_context) ? payload.approved_context : [];

  node.textContent = JSON.stringify(payload, null, 2);

  if (!readableNode) return;
  if (!blocks.length) {
    readableNode.innerHTML = '<p class="muted">ยังไม่มี approved context สำหรับส่งเข้า Agent</p>';
    return;
  }

  const cards = blocks
    .map((block, index) => {
      const text = compactText(block.selected_text || "-");
      const numeric = block.selected_numeric == null ? "-" : String(block.selected_numeric);
      const list = toDisplayList(block.selected_list).join(", ") || "-";
      const sourceType = String(block?.provenance?.evidence_source_type || "-");
      const sourceUrl = String(block?.provenance?.evidence_source_url || "").trim();
      const sourceUrlHtml = sourceUrl
        ? `<span class="preview-url">${buildEvidenceSourceUrlHtml(sourceUrl)}</span>`
        : "-";
      return `
        <article class="preview-card">
          <h4>Block ${index + 1}: ${escapeHtml(String(block.context_type || "fact"))}</h4>
          <p><strong>Text:</strong> ${escapeHtml(text)}</p>
          <p><strong>Numeric:</strong> ${escapeHtml(numeric)}</p>
          <p><strong>List:</strong> ${escapeHtml(list)}</p>
          <p><strong>Source Type:</strong> ${escapeHtml(sourceType)}</p>
          <p class="preview-url-row"><strong>Source URL:</strong> ${sourceUrlHtml}</p>
        </article>
      `;
    })
    .join("");

  readableNode.innerHTML = `<div class="preview-grid">${cards}</div>`;
}
async function loadEvidenceContextAndPreview() {
  const requests = [
    api(`/api/items/${state.itemId}/evidence-blocks`),
    api(`/api/items/${state.itemId}/approved-context`),
  ];
  if (isCleanMode) {
    requests.push(api(`/api/items/${state.itemId}/draft-input-preview`));
  }
  const [evidence, context, previewRes] = await Promise.all(requests);
  state.evidenceBlocks = Array.isArray(evidence?.blocks) ? evidence.blocks : [];
  state.approvedContextBlocks = Array.isArray(context?.blocks) ? context.blocks : [];
  if (!isCleanMode) {
    renderStepFourGuides();
    return;
  }
  state.draftInputPreview = previewRes?.preview || { approved_context: [] };
  renderEvidenceTable();
  renderApprovedContextTable();
  renderDraftInputPreviewPanel();
  renderCleanAiGuard();
}

function buildEvidencePayloadFromForm() {
  const numericRaw = String(qs("evidence-numeric-value")?.value || "").trim();
  const numericValue = numericRaw === "" ? null : Number(numericRaw);
  const sourceUrl = String(qs("evidence-source-url")?.value || "").trim();

  if (!sourceUrl) {
    throw new Error("กรุณากรอกลิงก์แหล่งอ้างอิง");
  }

  return {
    block_type: String(qs("evidence-block-type")?.value || "fact").trim() || "fact",
    source_type: String(qs("evidence-source-type")?.value || "manual").trim() || "manual",
    source_url: sourceUrl,
    attribution_text: String(qs("evidence-attribution")?.value || "").trim(),
    text_value: String(qs("evidence-text-value")?.value || "").trim(),
    numeric_value: Number.isFinite(numericValue) ? numericValue : null,
    list_value: parseCommaList(qs("evidence-list-value")?.value || ""),
    status: "active",
  };
}

function splitEvidenceBatchText(text, splitParagraphs = true) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (!splitParagraphs) return [normalized];
  return normalized
    .split(/\n\s*\n+/)
    .map((part) => part.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function buildEvidenceBatchPayloads() {
  const sourceUrl = String(qs("evidence-source-url")?.value || "").trim();
  const attributionText = String(qs("evidence-attribution")?.value || "").trim();
  const rawText = String(qs("evidence-batch-text")?.value || "");
  const splitParagraphs = qs("evidence-split-paragraphs")?.checked !== false;

  if (!sourceUrl) {
    throw new Error("กรุณากรอกลิงก์แหล่งอ้างอิง");
  }

  const paragraphs = splitEvidenceBatchText(rawText, splitParagraphs);
  if (!paragraphs.length) {
    throw new Error("ไม่พบข้อความสำหรับสร้าง evidence");
  }

  return paragraphs.map((text) => ({
    block_type: "mention",
    source_type: "manual",
    source_url: sourceUrl,
    attribution_text: attributionText,
    text_value: text,
    numeric_value: null,
    list_value: [],
    status: "active",
  }));
}

function clearEvidenceForm() {
  if (qs("evidence-batch-text")) qs("evidence-batch-text").value = "";
  if (qs("evidence-text-value")) qs("evidence-text-value").value = "";
  if (qs("evidence-numeric-value")) qs("evidence-numeric-value").value = "";
  if (qs("evidence-list-value")) qs("evidence-list-value").value = "";
}

async function runAiDraftFromApprovedContext(saveCurrentItem) {

  setStatus("กำลังบันทึกข้อมูลและเตรียมส่งให้ Agent...");
  await saveCurrentItem();

  await loadEvidenceContextAndPreview();
  const blockingMessages = getAgentBlockingMessages();
  if (blockingMessages.length > 0) {
    const message = blockingMessages[0];
    setStatus(message, true);
    setDraftPreviewStatus(message, true);
    return;
  }

  setStatus("กำลังรัน Agent...");

  // Keep audit trace of the exact structured context payload used before the generation run.
  await api(`/api/items/${state.itemId}/draft-input-preview?snapshot=1`);

  const aiResult = await api("/api/run/ai-draft", {
    method: "POST",
    body: JSON.stringify({ mode: "ai", allowFallback: false, content_item_id: state.itemId }),
  });

  setStatus(`Agent สร้าง draft แล้ว (${aiResult.count || 0} รายการ) กำลังไป Step 4 เพื่อรีวิวผล...`);
  setTimeout(() => {
    window.location.href = `/item-editor.html?id=${state.itemId}`;
  }, 350);
}

function getPreviousStepUrl() {
  if (isCleanMode) return "/?tab=raw";
  return "/clean-item.html?id=" + state.itemId;
}

function updateSelectedFileSummary() {
  const input = qs("asset-file");
  const help = qs("asset-file-help");
  if (!input || !help) return;

  const count = Array.from(input.files || []).length;
  if (!count) {
    help.textContent = "ยังไม่ได้เลือกไฟล์ รองรับการเลือกหลายไฟล์พร้อมกัน";
    return;
  }

  help.textContent = "เลือกแล้ว " + count + " ไฟล์";
}

function updateCoverPreview() {
  const img = qs("e-cover-preview");
  const url = String(qs("e-image")?.value || "").trim();
  if (!img) return;
  if (!url) {
    img.removeAttribute("src");
    img.classList.remove("is-broken");
    img.classList.add("hidden");
    return;
  }
  setImageWithFallback(img, url, () => setStatus("Cover preview image cannot be loaded.", true));
  img.classList.remove("hidden");
}

function renderCleanAiGuard() {
  if (!isCleanMode) return;
  const box = qs("clean-ai-guard");
  const nextBtn = qs("btn-next-ai");
  const runBtn = qs("btn-run-ai-context");
  if (!box) return;
  const editGuard = getEditPermissionGuard();


  const missing = [];
  missing.push(...getAgentBlockingMessages());
  if (!editGuard.allowed) {
    missing.push(editGuard.reason);
  }

  const ready = editGuard.allowed && getAgentBlockingMessages().length === 0;
  if (nextBtn) nextBtn.disabled = !ready;
  if (runBtn) runBtn.disabled = !ready;

  if (ready) {
    box.classList.remove("hidden");
    box.classList.add("ready");
    box.innerHTML = `<h4>พร้อมส่งให้ Agent</h4><ul><li>สามารถรัน AI draft จาก approved context ได้แล้ว</li></ul>`;
    return;
  }

  const list = missing.map((msg) => `<li>${escapeHtml(normalizeGuardMessage(msg))}</li>`).join("");
  box.classList.remove("hidden", "ready");
  box.innerHTML = `<h4>ยังส่งให้ Agent ไม่ได้</h4><ul>${list || "<li>ยังไม่ทราบสาเหตุ</li>"}</ul>`;
}
function fillForm(item) {
  qs("e-id").value = item.id;
  if (qs("e-id-readonly")) qs("e-id-readonly").value = item.id;
  qs("e-type").value = item.type || "place";
  qs("e-category").value = item.category || "attractions";
  qs("e-lang").value = item.lang || "th";
  qs("e-title").value = item.title || "";
  qs("e-source-name").value = item.source_name || "";
  qs("e-source-url").value = item.source_url || "";
  qs("e-lat").value = item.latitude ?? "";
  if (qs("e-lat-readonly")) qs("e-lat-readonly").value = item.latitude ?? "";
  qs("e-lng").value = item.longitude ?? "";
  if (qs("e-lng-readonly")) qs("e-lng-readonly").value = item.longitude ?? "";
  qs("e-image").value = item.image_url || "";
  if (qs("e-image-readonly")) qs("e-image-readonly").value = item.image_url || "";
  qs("e-tags").value = Array.isArray(item.tags) ? item.tags.join("|") : "";
  qs("e-description").value = item.description_clean || item.description_raw || "";
  updateCoverPreview();
}

function buildPayload() {
  const description = qs("e-description").value;
  return {
    id: state.itemId,
    type: qs("e-type").value,
    category: qs("e-category").value,
    lang: qs("e-lang").value,
    title: qs("e-title").value,
    source_name: qs("e-source-name").value,
    source_url: qs("e-source-url").value,
    latitude: qs("e-lat").value,
    longitude: qs("e-lng").value,
    image_url: qs("e-image").value,
    tags: qs("e-tags").value,
    description_raw: description,
    description_clean: description,
  };
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitDraftParagraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function splitDraftPoints(text) {
  return splitDraftParagraphs(text)
    .flatMap((part) => part.split(/\n|(?<=[.!?])\s+/))
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function categoryLabel(category) {
  const labels = {
    attractions: "ที่เที่ยว",
    activities: "กิจกรรม",
    hotels: "โรงแรม",
    cafes: "คาเฟ่",
    restaurants: "ร้านอาหาร",
    transport: "การเดินทาง",
  };
  return labels[String(category || "").trim()] || "ทั่วไป";
}

function buildCategoryAudience(category) {
  const map = {
    attractions: "คนที่กำลังมองหาที่เที่ยวใหม่ ๆ",
    activities: "คนที่อยากหา activity ทำในพื้นที่",
    hotels: "คนที่กำลังวางแผนหาที่พัก",
    cafes: "คนที่ชอบคาเฟ่และมุมถ่ายรูป",
    restaurants: "คนที่กำลังหาร้านอาหารน่าสนใจ",
    transport: "คนที่ต้องการข้อมูลการเดินทางที่ชัดเจน",
  };
  return map[String(category || "").trim()] || "คนที่กำลังหาข้อมูลก่อนตัดสินใจ";
}

function buildPrimaryCta(category, title) {
  const name = String(title || "สถานที่นี้").trim() || "สถานที่นี้";
  const map = {
    attractions: `ดูข้อมูล ${name} แล้ววางแผนทริปได้เลย`,
    activities: `เลือกกิจกรรมที่เหมาะกับคุณจาก ${name}`,
    hotels: `เช็กจุดเด่นและความเหมาะสมของ ${name}`,
    cafes: `ดูบรรยากาศและเมนูเด่นของ ${name}`,
    restaurants: `ดูเมนูและจุดเด่นก่อนเลือก ${name}`,
    transport: `เช็กเส้นทางและวิธีเดินทางของ ${name}`,
  };
  return map[String(category || "").trim()] || `ดูสรุปข้อมูลของ ${name}`;
}

function hasAnyKeyword(corpus, keywords) {
  const text = String(corpus || "").toLowerCase();
  return (Array.isArray(keywords) ? keywords : []).some((keyword) => text.includes(String(keyword).toLowerCase()));
}

function joinNaturalList(items, lastSeparator = " และ ") {
  const list = (Array.isArray(items) ? items : []).map((item) => normalizeWhitespace(item)).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]}${lastSeparator}${list[1]}`;
  return `${list.slice(0, -1).join(", ")}${lastSeparator}${list[list.length - 1]}`;
}

function getLeadSignalLabels(signals, maxItems = 3) {
  return (Array.isArray(signals) ? signals : []).slice(0, maxItems).map((signal) => signal.shortLabel).filter(Boolean);
}

function buildAngleNarrative(data, signals) {
  const category = String(data.category || "").trim();
  const title = data.fallbackTitle;
  const labels = joinNaturalList(getLeadSignalLabels(signals, 3)) || data.categoryLabel;

  switch (category) {
    case "cafes":
      return `พาไปดู ${title} ผ่านมุมสำคัญอย่าง ${labels} เพื่อช่วยตัดสินใจก่อนไปจริง`;
    case "restaurants":
      return `สำรวจ ${title} ผ่านข้อมูล ${labels} เพื่อเลือกร้านได้ตรงความต้องการ`;
    case "attractions":
      return `แนะนำ ${title} ด้วยข้อมูล ${labels} ให้วางแผนเที่ยวได้ง่ายขึ้น`;
    case "activities":
      return `สรุปกิจกรรม ${title} จากประเด็น ${labels} เพื่อเลือกให้เหมาะกับเวลาและสไตล์`;
    case "hotels":
      return `ดูภาพรวม ${title} จาก ${labels} เพื่อช่วยตัดสินใจเรื่องที่พัก`;
    case "transport":
      return `อธิบาย ${title} ด้วยข้อมูล ${labels} เพื่อให้เดินทางได้ถูกต้องและสะดวก`;
    default:
      return `สรุป ${title} ผ่านข้อมูล ${labels} แบบเข้าใจง่าย`;
  }
}

function buildKeyMessageFromSignals(data, signals) {
  const category = String(data.category || "").trim();
  const title = data.fallbackTitle;
  const first = signals[0]?.shortLabel || data.categoryLabel;
  const second = signals[1]?.shortLabel || "บรรยากาศ";
  const third = signals[2]?.shortLabel || "ข้อควรรู้";

  switch (category) {
    case "cafes":
      return `คาเฟ่ ${title} เด่นที่ ${first}, ${second} และ ${third} พร้อมข้อมูลใช้งานจริง`;
    case "restaurants":
      return `ร้าน ${title} มีข้อมูล ${first}, ${second} และ ${third} ครบก่อนตัดสินใจ`;
    case "attractions":
      return `ที่เที่ยว ${title} สรุป ${first}, ${second} และ ${third} แบบใช้งานได้ทันที`;
    case "activities":
      return `${title} ครบทั้ง ${first}, ${second} และ ${third} สำหรับคนอยากทำกิจกรรม`;
    case "hotels":
      return `โรงแรม ${title} มีจุดเด่น ${first}, ${second} และ ${third} อย่างชัดเจน`;
    case "transport":
      return `ข้อมูลเดินทาง ${title} ครอบคลุม ${first}, ${second} และ ${third} เพื่อใช้งานจริง`;
    default:
      return `สรุป ${title} ด้วย ${first}, ${second} และ ${third}`;
  }
}

function buildSignalHook(data, signals) {
  const title = data.fallbackTitle;
  const category = String(data.category || "").trim();
  const firstHeadline = signals[0]?.headline || `ไฮไลต์${data.categoryLabel}`;

  if (category === "transport") {
    return compactText(`${title}: เส้นทางชัด จุดขึ้นลงครบ ใช้งานได้จริง`, 90);
  }
  if (category === "cafes" || category === "restaurants") {
    return compactText(`${title}: บรรยากาศดีและมีข้อมูลที่ควรรู้ก่อนไป`, 90);
  }
  return compactText(`${title}: ${firstHeadline}`, 90);
}

function buildPlatformDirection(platform, data, signals) {
  const title = data.fallbackTitle;
  const categoryLabelText = data.categoryLabel;
  const first = signals[0]?.shortLabel || categoryLabelText;
  const second = signals[1]?.shortLabel || "จุดเด่น";
  const third = signals[2]?.shortLabel || "ข้อควรรู้";

  switch (platform) {
    case "website":
      return `เน้น ${first} เสริม ${second} และ ${third} เพื่อให้หน้าเว็บของ ${title} อ่านง่ายและตัดสินใจได้`;
    case "facebook":
      return `เปิดด้วย ${first} เป็น hook แล้วต่อด้วย ${second} พร้อม social proof ของ ${title}`;
    case "instagram":
      return `เล่า ${first} แบบกระชับ ใส่ ${second} และ ${third} ให้เหมาะกับการอ่านบนมือถือ`;
    case "reels":
      return `ทำคลิป ${title} โดยโชว์ ${first} ตามด้วย ${second} ปิดท้าย ${third} และ CTA ชัดเจน`;
    default:
      return `สรุป ${title} ด้วย ${joinNaturalList(getLeadSignalLabels(signals, 3)) || categoryLabelText}`;
  }
}

function getSignalPriority(category) {
  const map = {
    cafes: ["atmosphere", "signature", "use_case", "social_proof", "limitations"],
    restaurants: ["signature", "dining_experience", "audience_fit", "social_proof", "limitations"],
    attractions: ["destination_highlight", "experience", "timing", "convenience", "limitations"],
    activities: ["experience", "audience_fit", "conditions", "value", "limitations"],
    hotels: ["stay_highlight", "audience_fit", "amenities", "social_proof", "limitations"],
    transport: ["main_function", "convenience", "clarity", "audience_fit", "limitations"],
  };
  return map[String(category || "").trim()] || ["experience", "audience_fit", "social_proof", "limitations"];
}

function buildSignalDescriptor(category, signalKey, data) {
  const corpus = String(data.textCorpus || "").toLowerCase();
  const title = data.fallbackTitle;

  switch (signalKey) {
    case "atmosphere":
      return {
        shortLabel: "บรรยากาศ",
        headline: "โทนและความรู้สึกของสถานที่",
        summary: hasAnyKeyword(corpus, ["ชิล", "bar", "วิวดี", "อบอุ่น", "นั่งนาน", "เงียบ", "ถ่ายรูป"])
          ? `พบสัญญาณด้าน mood ของ ${title} ในข้อมูลต้นทาง ควรดึงมาเป็นจุดขายหลัก`
          : `ควรอธิบายบรรยากาศของ ${title} ให้ผู้อ่านเห็นภาพตั้งแต่ย่อหน้าแรก`,
        verification: `ตรวจว่ามีคำอธิบาย mood ของ ${title} ชัดเจนใน draft`,
        fieldTask: `สรุปบรรยากาศหลักที่ผู้ใช้จะสัมผัสได้จริงจาก ${title}`,
      };
    case "signature":
      return {
        shortLabel: "จุดเด่น",
        headline: "สิ่งที่ทำให้สถานที่นี้แตกต่าง",
        summary: hasAnyKeyword(corpus, ["เมนู", "กาแฟ", "americano", "menu", "อาหาร", "เด็ด", "ดัง"])
          ? `มีหลักฐานเพียงพอให้เล่าจุดเด่นเฉพาะของ ${title} ได้ชัด`
          : `ควรหาและระบุเอกลักษณ์หลักของ ${title} ให้ชัดเจนขึ้น`,
        verification: `ตรวจว่ามีประโยคสรุปจุดเด่นของ ${title} อย่างน้อย 1 จุด`,
        fieldTask: `ระบุ signature ที่ทำให้คนจดจำ ${title} ได้`,
      };
    case "use_case":
      return {
        shortLabel: "เหมาะกับใคร",
        headline: "รูปแบบการใช้งานที่เหมาะสม",
        summary: hasAnyKeyword(corpus, ["เหมาะ", "ครอบครัว", "เด็ก", "คู่", "กลุ่ม"])
          ? `ข้อมูลชี้ว่า ${title} เหมาะกับ use case เฉพาะ ควรสื่อให้ชัด`
          : `ควรเพิ่มคำอธิบายว่า ${title} เหมาะกับสถานการณ์แบบไหน`,
        verification: `ตรวจว่ามี use case ของ ${title} ที่นำไปใช้ได้จริง`,
        fieldTask: `สรุปกลุ่มผู้ใช้และจังหวะที่เหมาะกับ ${title}`,
      };
    case "social_proof":
      return {
        shortLabel: "ความน่าเชื่อถือ",
        headline: "หลักฐานจากผู้ใช้งานหรือคะแนนรีวิว",
        summary: hasAnyKeyword(corpus, ["รีวิว", "review", "คะแนน", "4.", "5.", "แนะนำ", "ยอดนิยม"])
          ? `มี social proof ที่ช่วยเสริมความน่าเชื่อถือของ ${title}`
          : `ควรเพิ่ม social proof ของ ${title} เช่นคะแนนหรือรีวิว`,
        verification: `ตรวจว่ามีตัวเลข/ข้อความรีวิวสนับสนุน ${title}`,
        fieldTask: `ดึงหลักฐานที่ยืนยันคุณภาพจากแหล่งที่เชื่อถือได้`,
      };
    case "limitations":
      return {
        shortLabel: "ข้อควรรู้",
        headline: "ข้อจำกัดหรือเงื่อนไขการใช้งาน",
        summary: hasAnyKeyword(corpus, ["ไกล", "แพง", "คิวยาว", "ปิดเร็ว", "ชัน", "แคบ"])
          ? `พบข้อจำกัดของ ${title} ที่ควรแจ้งไว้ก่อนตัดสินใจ`
          : `ควรเพิ่มข้อควรรู้/ข้อจำกัดของ ${title} ใน brief`,
        verification: `ตรวจว่ามีส่วนข้อควรรู้ของ ${title} ชัดเจน`,
        fieldTask: `สรุปข้อจำกัดสำคัญที่ผู้ใช้ควรรู้ล่วงหน้า`,
      };
    case "dining_experience":
      return {
        shortLabel: "ประสบการณ์กิน",
        headline: "ประสบการณ์ที่ลูกค้าจะได้รับ",
        summary: `อธิบายประสบการณ์การใช้งาน ${title} แบบเห็นภาพและตัดสินใจได้`,
        verification: `ตรวจว่าดราฟต์มีรายละเอียดประสบการณ์ของ ${title}`,
        fieldTask: `สรุปบรรยากาศบริการและความรู้สึกหลังใช้งาน`,
      };
    case "audience_fit":
      return {
        shortLabel: "กลุ่มเป้าหมาย",
        headline: "ความเหมาะสมกับผู้ใช้แต่ละกลุ่ม",
        summary: `ระบุกลุ่มที่เหมาะกับ ${title} ให้ชัดเจนและนำไปใช้ได้`,
        verification: `ตรวจว่ามี target audience ของ ${title}`,
        fieldTask: `จับคู่ ${title} กับกลุ่มผู้ใช้ที่เหมาะสม`,
      };
    case "destination_highlight":
      return {
        shortLabel: "ไฮไลต์จุดหมาย",
        headline: "จุดเด่นที่ทำให้สถานที่น่าไป",
        summary: `ดึงไฮไลต์หลักของ ${title} ให้คนเห็นเหตุผลที่ควรไป`,
        verification: `ตรวจว่ามี destination highlight ของ ${title}`,
        fieldTask: `สรุปจุดเด่นเชิงปลายทางของ ${title}`,
      };
    case "experience":
      return {
        shortLabel: "ประสบการณ์หลัก",
        headline: "สิ่งที่จะได้เจอเมื่อไปจริง",
        summary: `อธิบายประสบการณ์หลักจาก ${title} ให้เป็นขั้นตอนเข้าใจง่าย`,
        verification: `ตรวจว่ามีคำอธิบายประสบการณ์ของ ${title}`,
        fieldTask: `สรุป user experience ของ ${title}`,
      };
    case "timing":
      return {
        shortLabel: "ช่วงเวลาที่เหมาะ",
        headline: "ควรไปเวลาไหนให้คุ้มที่สุด",
        summary: `ระบุช่วงเวลาที่เหมาะกับ ${title} พร้อมเหตุผลประกอบ`,
        verification: `ตรวจว่ามีข้อมูลเวลาใช้งานของ ${title}`,
        fieldTask: `เพิ่ม guidance เรื่องเวลา/ช่วงที่เหมาะสมของ ${title}`,
      };
    case "convenience":
      return {
        shortLabel: "ความสะดวก",
        headline: String(category) === "transport" ? "ความชัดเจนในการเดินทาง" : "ความสะดวกในการใช้งาน",
        summary: String(category) === "transport"
          ? `อธิบายการใช้งาน ${title} ให้เข้าใจง่าย ไม่สับสนเรื่องเส้นทาง`
          : `สรุปจุดที่ทำให้ ${title} ใช้งานสะดวกในชีวิตจริง`,
        verification: `ตรวจว่าความสะดวกของ ${title} ถูกอธิบายครบ`,
        fieldTask: `สรุป convenience ของ ${title} แบบ actionable`,
      };
    case "conditions":
      return {
        shortLabel: "เงื่อนไขสำคัญ",
        headline: "เงื่อนไขที่ต้องรู้ก่อนใช้งาน",
        summary: `ระบุเงื่อนไขสำคัญที่มีผลต่อการใช้งาน ${title}`,
        verification: `ตรวจว่ามีเงื่อนไขการใช้งานครบสำหรับ ${title}`,
        fieldTask: `สรุปเงื่อนไขที่มีผลต่อการตัดสินใจของผู้ใช้`,
      };
    case "value":
      return {
        shortLabel: "ความคุ้มค่า",
        headline: "สิ่งที่ได้เทียบกับต้นทุน",
        summary: `อธิบายความคุ้มค่าของ ${title} ในมุมผู้ใช้งานจริง`,
        verification: `ตรวจว่ามีข้อมูล value proposition ของ ${title}`,
        fieldTask: `สรุปความคุ้มค่าและเหตุผลประกอบสำหรับ ${title}`,
      };
    case "stay_highlight":
      return {
        shortLabel: "ไฮไลต์ที่พัก",
        headline: "จุดเด่นของประสบการณ์การพัก",
        summary: `ดึงจุดเด่นของการเข้าพักจาก ${title} ให้ชัดเจน`,
        verification: `ตรวจว่ามี stay highlight ของ ${title} ใน draft`,
        fieldTask: `สรุปจุดเด่นหลักสำหรับการพักที่ ${title}`,
      };
    case "amenities":
      return {
        shortLabel: "สิ่งอำนวยความสะดวก",
        headline: "รายการสิ่งอำนวยความสะดวกที่มีผลต่อการเลือก",
        summary: `สรุป amenities ของ ${title} ที่ผู้ใช้ต้องการรู้ก่อนจอง`,
        verification: `ตรวจว่ามีข้อมูล amenities ของ ${title} ครบ`,
        fieldTask: `รวบรวมสิ่งอำนวยความสะดวกสำคัญ เช่น ที่จอดรถ ห้องน้ำ wifi`,
      };
    case "main_function":
      return {
        shortLabel: "หน้าที่หลัก",
        headline: "บทบาทหลักที่แก้ปัญหาให้ผู้ใช้",
        summary: `อธิบายฟังก์ชันหลักของ ${title} และ pain point ที่ช่วยแก้`,
        verification: `ตรวจว่า main function ของ ${title} ถูกสื่อชัดเจน`,
        fieldTask: `สรุปหน้าที่หลักและผู้ใช้เป้าหมายของ ${title}`,
      };
    case "clarity":
      return {
        shortLabel: "ความชัดเจนข้อมูล",
        headline: "ข้อมูลที่ต้องชัดและไม่ทำให้สับสน",
        summary: `จัดข้อมูลของ ${title} ให้ชัดเจนและลดความเข้าใจผิด`,
        verification: `ตรวจว่าข้อมูลสำคัญของ ${title} อ่านแล้วไม่สับสน`,
        fieldTask: `เขียนข้อมูลสำคัญของ ${title} ให้ตรงไปตรงมา`,
      };
    default:
      return {
        shortLabel: "ประเด็นหลัก",
        headline: "สรุปสาระสำคัญของข้อมูล",
        summary: `สรุป ${title} ให้เข้าใจง่ายและใช้งานได้`,
        verification: `ตรวจว่ามีสาระสำคัญของ ${title} ชัดเจน`,
        fieldTask: `ดึงประเด็นหลักที่ควรสื่อของ ${title}`,
      };
  }
}

function buildPrimarySignals(data) {
  return getSignalPriority(data.category).map((signalKey) => buildSignalDescriptor(data.category, signalKey, data));
}

function buildDraftGuideData() {
  const title = String(qs("e-title")?.value || state.item?.title || "").trim();
  const category = String(qs("e-category")?.value || state.item?.category || "").trim();
  const description = String(qs("e-description")?.value || "");
  const tags = String(qs("e-tags")?.value || "")
    .split("|")
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
  const sourceName = String(qs("e-source-name")?.value || "").trim();
  const sourceUrl = String(qs("e-source-url")?.value || "").trim();
  const coverUrl = sanitizeUrl(qs("e-image")?.value || "");
  const paragraphs = splitDraftParagraphs(description);
  const points = splitDraftPoints(description);
  const firstParagraph = paragraphs[0] || "";
  const firstPoint = points[0] || firstParagraph || title;
  const fallbackTitle = title || `(ยังไม่ได้ตั้งชื่อ${categoryLabel(category)})`;
  const galleryCount = (Array.isArray(state.assets) ? state.assets : []).filter((row) => String(row.role || "") === "gallery").length;
  const assetCount = Array.isArray(state.assets) ? state.assets.length : 0;
  const audience = buildCategoryAudience(category);
  const textCorpus = [title, description, tags.join(" "), sourceName, sourceUrl].filter(Boolean).join(" ");
  const baseData = {
    title,
    fallbackTitle,
    category,
    categoryLabel: categoryLabel(category),
    tags,
    sourceName,
    sourceUrl,
    coverUrl,
    paragraphs,
    points,
    firstParagraph,
    firstPoint,
    galleryCount,
    assetCount,
    audience,
    textCorpus,
  };
  const primarySignals = buildPrimarySignals(baseData);
  const signalFocus = joinNaturalList(getLeadSignalLabels(primarySignals, 3), " + ") || `เน้น ${categoryLabel(category)} และประเด็นสำคัญที่เกี่ยวข้อง`;
  const angle = compactText(buildAngleNarrative(baseData, primarySignals), 180);
  const keyMessage = compactText(buildKeyMessageFromSignals(baseData, primarySignals), 160);
  const hook = buildSignalHook(baseData, primarySignals);
  const cta = buildPrimaryCta(category, title);
  const sourceSummary = buildEditorReferenceSourceSummary();
  const sourceSummaryLinks = buildEditorReferenceSourceLinks();
  return {
    ...baseData,
    signalFocus,
    angle,
    keyMessage,
    hook,
    cta,
    primarySignals,
    sourceSummaryText: sourceSummary.summaryText,
    sourceSummaryLinks,
    descriptionLength: normalizeWhitespace(description).length,
  };
}

function buildFieldPackDefaults() {
  const data = buildDraftGuideData();
  const aiCards = buildAiSummaryCardsFromData(data);
  const factCards = buildFactCheckCardsFromData(data);
  const fieldCards = buildFieldPackCardsFromData(data);
  return {
    status: "draft",
    writer_ready: false,
    // Use canonical generated data instead of display-label matching.
    ai_summary: data.angle || "",
    ai_highlights: aiCards[0]?.items || [],
    ai_unknowns: aiCards[1]?.items || [],
    editor_summary: "",
    verified_facts: factCards[0]?.items || [],
    uncertain_facts: factCards[1]?.items || [],
    story_angle: data.angle || "",
    field_notes: "",
    must_verify_facts: fieldCards[0]?.items || [],
    must_capture_items: buildMustCaptureEditorRowsFromCards(fieldCards[1]?.items || []),
    must_capture_shots: fieldCards[1]?.items || [],
    must_ask_questions: fieldCards[2]?.items || [],
    social_hook: data.hook || "",
    social_shot_emphasis: fieldCards[1]?.items || [],
    social_on_camera_points: fieldCards[3]?.items || [],
    // Keep default caption guidance stable even if UI labels are renamed.
    social_caption_angle: buildPlatformDirection("facebook", data, data.primarySignals.slice(0, 3)),
  };
}

const REQUESTED_CHECK_GROUP_TEMPLATES = [
  {
    group_key: "cta_contact",
    group_label: "CTA/ติดต่อ",
    checks: [
      { key: "phone", label: "เบอร์โทร", answer_type: "phone", instruction: "ขอเบอร์ที่ติดต่อได้จริง", condition_prompt: "", evidence_required: true },
      { key: "line_url", label: "ลิงก์ LINE", answer_type: "url", instruction: "ถ้ามีให้ขอลิงก์ที่ใช้ได้จริง", condition_prompt: "", evidence_required: false },
      { key: "facebook_url", label: "ลิงก์ Facebook", answer_type: "url", instruction: "ถ้ามีให้ขอลิงก์เพจที่ถูกต้อง", condition_prompt: "", evidence_required: false },
      { key: "website_url", label: "ลิงก์เว็บไซต์", answer_type: "url", instruction: "ถ้ามีให้ขอลิงก์เว็บไซต์หลัก", condition_prompt: "", evidence_required: false },
      { key: "primary_cta", label: "CTA หลัก", answer_type: "select", instruction: "ยืนยันว่าควรพาคนไปกดอะไรเป็นหลัก", condition_prompt: "", evidence_required: false },
    ],
  },
  {
    group_key: "taxonomy",
    group_label: "หมวดหมู่",
    checks: [
      { key: "category", label: "หมวดหลัก", answer_type: "text", instruction: "ยืนยันหมวดหลักของสถานที่", condition_prompt: "", evidence_required: false },
      { key: "subtype", label: "หมวดย่อย", answer_type: "text", instruction: "ยืนยันหมวดย่อยที่ตรงที่สุด", condition_prompt: "", evidence_required: false },
      { key: "tags", label: "แท็ก", answer_type: "multi_select", instruction: "ดูว่ามีแท็กไหนควรเติม", condition_prompt: "", evidence_required: false },
    ],
  },
];

const REQUESTED_CHECK_ANSWER_TYPE_OPTIONS = [
  ["text", "ข้อความ"],
  ["url", "ลิงก์"],
  ["phone", "เบอร์โทร"],
  ["select", "เลือก 1 ค่า"],
  ["multi_select", "เลือกหลายค่า"],
  ["boolean", "ใช่/ไม่ใช่"],
  ["boolean_with_conditions", "ใช่/ไม่ใช่ พร้อมเงื่อนไข"],
  ["number_with_unit", "ตัวเลขพร้อมหน่วย"],
  ["hours", "เวลาเปิดปิด"],
  ["note_only", "บันทึกอย่างเดียว"],
];

function getRequestedCheckDefaultGroupLabel(groupKey) {
  const normalized = String(groupKey || "").trim().toLowerCase();
  const template = REQUESTED_CHECK_GROUP_TEMPLATES.find((group) => group.group_key === normalized);
  if (template?.group_label) return template.group_label;
  if (normalized === "custom") return "เช็กเพิ่ม";
  return normalized || "custom";
}

function normalizeRequestedCheckKey(rawKey) {
  return String(rawKey || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function parseRequestedCheckSuggestedValue(rawValue, answerType = "text") {
  const text = String(rawValue || "").trim();
  if (!text) return null;
  if (answerType === "multi_select") return parseLineList(text);
  if (answerType === "boolean" || answerType === "boolean_with_conditions") {
    if (text === "true") return true;
    if (text === "false") return false;
    return null;
  }
  if (answerType === "number_with_unit") {
    try {
      return JSON.parse(text);
    } catch {
      const numeric = Number(text);
      return Number.isFinite(numeric) ? { number: numeric, unit: null } : null;
    }
  }
  if (answerType === "select" && text.includes("\n")) return text.split("\n")[0].trim() || null;
  return text;
}

function isPlaceRequestedCheckItem(item = state.item) {
  return String(item?.type || "").trim().toLowerCase() === "place";
}

function shouldKeepRequestedCheckGroupForItem(groupKey, item = state.item) {
  const normalizedGroupKey = String(groupKey || "").trim().toLowerCase();
  if (normalizedGroupKey === "cta_contact") return isPlaceRequestedCheckItem(item);
  return true;
}

function filterRequestedCheckGroupsForItem(groups = [], item = state.item) {
  return (Array.isArray(groups) ? groups : []).filter((group) => {
    return shouldKeepRequestedCheckGroupForItem(group?.group_key, item);
  });
}

function mergeRequestedChecksForSave(uiState = {}, existingState = {}) {
  const existingGroups = new Map(
    (Array.isArray(existingState?.groups) ? existingState.groups : []).map((group) => [String(group.group_key || "").trim().toLowerCase(), group])
  );
  const uiGroups = new Map(
    (Array.isArray(uiState?.groups) ? uiState.groups : []).map((group) => [String(group.group_key || "").trim().toLowerCase(), group])
  );
  const preservedHiddenGroupKeys = Array.from(existingGroups.keys()).filter((groupKey) => {
    return groupKey === "cta_contact" && !uiGroups.has(groupKey);
  });
  const orderedGroupKeys = Array.from(new Set([
    ...REQUESTED_CHECK_GROUP_TEMPLATES.map((group) => group.group_key),
    ...preservedHiddenGroupKeys,
    ...uiGroups.keys(),
  ])).filter((groupKey) => uiGroups.has(groupKey) || preservedHiddenGroupKeys.includes(groupKey));

  return {
    version: 1,
    groups: orderedGroupKeys.map((groupKey) => {
      const existingGroup = existingGroups.get(groupKey) || {};
      const uiGroup = uiGroups.get(groupKey) || {};
      if (!uiGroups.has(groupKey)) {
        return {
          group_key: groupKey,
          group_label: getRequestedCheckDefaultGroupLabel(groupKey),
          checks: Array.isArray(existingGroup.checks) ? existingGroup.checks : [],
        };
      }
      const templateChecks = REQUESTED_CHECK_GROUP_TEMPLATES.find((group) => group.group_key === groupKey)?.checks || [];
      const existingChecks = new Map(
        (Array.isArray(existingGroup.checks) ? existingGroup.checks : []).map((check) => [normalizeRequestedCheckKey(check.key), check])
      );
      const uiChecks = Array.isArray(uiGroup.checks) ? uiGroup.checks : [];
      const normalizedKeys = uiChecks.map((uiCheck, index) => {
        if (groupKey !== "custom") return String(templateChecks[index]?.key || "").trim().toLowerCase();
        return normalizeRequestedCheckKey(uiCheck?.key);
      });
      if (normalizedKeys.some((key) => !key)) {
        throw new Error(`Requested check key is required for group "${groupKey}"`);
      }
      const seenKeys = new Set();
      normalizedKeys.forEach((key) => {
        if (seenKeys.has(key)) throw new Error(`Duplicate requested check key "${key}" in group "${groupKey}"`);
        seenKeys.add(key);
      });
      return {
        group_key: groupKey,
        group_label: getRequestedCheckDefaultGroupLabel(groupKey),
        // Save is driven by rows still present in the editor. Missing rows are deletions.
        checks: uiChecks.map((uiCheck, index) => {
          const checkKey = normalizedKeys[index];
          const existingCheck = existingChecks.get(checkKey) || {};
          return {
            key: checkKey,
            requested: uiCheck.requested === true,
            label: String(uiCheck.label || existingCheck.label || "").trim(),
            instruction: String(uiCheck.instruction || existingCheck.instruction || "").trim(),
            answer_type: String(uiCheck.answer_type || existingCheck.answer_type || "text").trim() || "text",
            suggested_value: Object.prototype.hasOwnProperty.call(existingCheck, "suggested_value")
              ? existingCheck.suggested_value
              : null,
            condition_prompt: uiCheck.condition_prompt == null
              ? (existingCheck.condition_prompt ?? null)
              : String(uiCheck.condition_prompt || "").trim() || null,
            evidence_required: uiCheck.evidence_required === true,
            source: Object.prototype.hasOwnProperty.call(existingCheck, "source")
              ? existingCheck.source
              : null,
          };
        }).filter((check) => check.key || check.label || check.instruction || check.requested || check.suggested_value != null || check.source != null),
      };
    }).filter((group) => Array.isArray(group.checks) && group.checks.length > 0),
  };
}

function buildRequestedChecksEditorState(fieldPack = {}) {
  const saved = fieldPack?.requested_checks_json && typeof fieldPack.requested_checks_json === "object"
    ? fieldPack.requested_checks_json
    : { version: 1, groups: [] };
  const savedGroups = new Map(
    (Array.isArray(saved.groups) ? saved.groups : []).map((group) => [String(group.group_key || "").trim().toLowerCase(), group])
  );
  const aiCta = fieldPack?.ai_cta_contact_json && typeof fieldPack.ai_cta_contact_json === "object" ? fieldPack.ai_cta_contact_json : {};
  const aiTaxonomy = fieldPack?.ai_taxonomy_json && typeof fieldPack.ai_taxonomy_json === "object" ? fieldPack.ai_taxonomy_json : {};
  const sourceMeta = {
    kind: "ai",
    confidence: aiCta.confidence || aiTaxonomy.confidence || "unknown",
    note: null,
  };

  const groups = REQUESTED_CHECK_GROUP_TEMPLATES.map((template) => {
    const savedGroup = savedGroups.get(template.group_key) || {};
    const savedChecks = new Map(
      (Array.isArray(savedGroup.checks) ? savedGroup.checks : []).map((check) => [String(check.key || "").trim().toLowerCase(), check])
    );
    return {
      group_key: template.group_key,
      group_label: template.group_label,
      checks: template.checks.map((check) => {
        const savedCheck = savedChecks.get(check.key) || {};
        const aiSuggestedValue = template.group_key === "cta_contact"
          ? aiCta[check.key]
          : aiTaxonomy[check.key];
        return {
          key: check.key,
          requested: savedCheck.requested === true,
          label: String(savedCheck.label || check.label || "").trim(),
          instruction: String(savedCheck.instruction || check.instruction || "").trim(),
          answer_type: String(savedCheck.answer_type || check.answer_type || "text").trim() || "text",
          suggested_value: Object.prototype.hasOwnProperty.call(savedCheck, "suggested_value")
            ? savedCheck.suggested_value
            : (aiSuggestedValue ?? null),
          condition_prompt: savedCheck.condition_prompt == null
            ? (String(check.condition_prompt || "").trim() || null)
            : String(savedCheck.condition_prompt || "").trim() || null,
          evidence_required: savedCheck.evidence_required === true || check.evidence_required === true,
          source: savedCheck.source || (aiSuggestedValue != null ? sourceMeta : null),
        };
      }),
    };
  });

  const customGroup = savedGroups.get("custom");
  groups.push({
    group_key: "custom",
    group_label: String(customGroup?.group_label || "เช็กเพิ่ม").trim() || "เช็กเพิ่ม",
    checks: (Array.isArray(customGroup?.checks) ? customGroup.checks : []).map((check, index) => ({
      key: String(check.key || `custom_${index + 1}`).trim().toLowerCase() || `custom_${index + 1}`,
      requested: check.requested === true,
      label: String(check.label || "").trim(),
      instruction: String(check.instruction || "").trim(),
      answer_type: String(check.answer_type || "text").trim() || "text",
      suggested_value: Object.prototype.hasOwnProperty.call(check, "suggested_value") ? check.suggested_value : null,
      condition_prompt: check.condition_prompt == null ? null : String(check.condition_prompt || "").trim() || null,
      evidence_required: check.evidence_required === true,
      source: check.source || null,
    })),
  });

  return {
    version: 1,
    groups,
  };
}

function getRequestedCheckEditorGroups(fieldPack = {}, item = state.item) {
  const stateValue = buildRequestedChecksEditorState(fieldPack);
  return (Array.isArray(stateValue.groups) ? stateValue.groups : []).filter((group) => {
    const groupKey = String(group?.group_key || "").trim().toLowerCase();
    if (groupKey === "cta_contact") return isPlaceRequestedCheckItem(item);
    return true;
  });
}

function buildRequestedChecksPreviewHtml(requestedChecks = { version: 1, groups: [] }, fieldPack = state.fieldPack || null) {
  return buildRequestedChecksCompactPreviewHtml(requestedChecks, fieldPack, state.item);
}

function renderRequestedChecksPreview(requestedChecks = readRequestedChecksEditorState()) {
  const node = qs("fp-requested-checks-preview");
  if (!node) return;
  node.innerHTML = "";
}

function renderRequestedChecksEditor(fieldPack = {}) {
  const root = qs("fp-requested-checks-editor");
  if (!root) return;
  root.innerHTML = buildRequestedChecksEditorHtml(fieldPack, state.item);
  root.querySelectorAll("textarea").forEach((node) => autosizeTextarea(node));
}

function readRequestedChecksEditorState() {
  const root = qs("fp-requested-checks-editor");
  if (!root) return { version: 1, groups: [] };
  const groups = Array.from(root.querySelectorAll("[data-requested-group]")).map((groupNode) => {
    const groupKey = String(groupNode.getAttribute("data-requested-group") || "").trim().toLowerCase();
    const groupLabel = getRequestedCheckDefaultGroupLabel(groupKey);
    const checks = Array.from(groupNode.querySelectorAll("[data-requested-check-row]")).map((rowNode) => {
      const answerType = String(rowNode.querySelector("[data-check-field='answer_type']")?.value || "text").trim() || "text";
      return {
        key: String(rowNode.querySelector("[data-check-field='key']")?.value || "").trim().toLowerCase(),
        requested: rowNode.querySelector("[data-check-field='requested']")?.checked === true,
        label: String(rowNode.querySelector("[data-check-field='label']")?.value || "").trim(),
        instruction: String(rowNode.querySelector("[data-check-field='instruction']")?.value || "").trim(),
        answer_type: answerType,
        condition_prompt: String(rowNode.querySelector("[data-check-field='condition_prompt']")?.value || "").trim() || null,
        evidence_required: rowNode.querySelector("[data-check-field='evidence_required']")?.checked === true,
      };
    }).filter((check) => check.key || check.label || check.instruction || check.requested);
    return {
      group_key: groupKey,
      group_label: groupLabel,
      checks,
    };
  });
  return {
    version: 1,
    groups,
  };
}

function getRequestedCheckStatusBadge(label, tone = "neutral") {
  const className = tone === "warning"
    ? "workflow-badge workflow-badge-generated"
    : tone === "ok"
      ? "workflow-badge workflow-badge-sent"
      : "workflow-badge";
  return `<span class="${className}">${escapeHtml(label)}</span>`;
}

function hasRequestedCheckMeaningfulValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value != null && String(value).trim() !== "";
}

function buildRequestedCheckCompactGroups(requestedChecks = { version: 1, groups: [] }) {
  const compactMap = new Map([
    ["cta_contact", { key: "cta_contact", label: "CTA Review", checks: [] }],
    ["taxonomy", { key: "taxonomy", label: "Suggested Focus", checks: [] }],
    ["custom", { key: "custom", label: "Article context", checks: [] }],
  ]);
  const groups = Array.isArray(requestedChecks?.groups) ? requestedChecks.groups : [];
  groups.forEach((group) => {
    const groupKey = String(group?.group_key || "").trim().toLowerCase();
    const target = compactMap.get(compactMap.has(groupKey) ? groupKey : "custom");
    (Array.isArray(group?.checks) ? group.checks : []).forEach((check) => target.checks.push(check));
  });
  return Array.from(compactMap.values()).filter((group) => group.checks.length > 0);
}

function extractRequestedCheckArticleContextHints(groups = []) {
  return groups.flatMap((group) => {
    return (Array.isArray(group?.checks) ? group.checks : []).filter((check) => check?.requested === true).flatMap((check) => {
      const hints = [];
      const instruction = String(check?.instruction || "").trim();
      if (instruction) hints.push(instruction);
      const condition = String(check?.condition_prompt || "").trim();
      if (condition) hints.push(condition);
      return hints;
    });
  }).filter(Boolean);
}

function buildRequestedCheckStatusRow(key, label, value, statuses = []) {
  const normalizedStatuses = Array.isArray(statuses)
    ? Array.from(new Set(statuses.filter(Boolean)))
    : [];
  return {
    key: String(key || "").trim().toLowerCase(),
    label: String(label || "").trim() || "-",
    value: hasRequestedCheckMeaningfulValue(value) ? formatRequestedCheckSuggestedValue(value) : "",
    statuses: normalizedStatuses,
  };
}

function normalizeRequestedCheckCandidate(rawValue) {
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    return {
      value: Object.prototype.hasOwnProperty.call(rawValue, "value") ? rawValue.value : null,
      checked: rawValue.checked === true,
      found: rawValue.found === true,
    };
  }
  return {
    value: rawValue,
    checked: false,
    found: false,
  };
}

function getGuidanceSourceObjects(fieldPack = {}, item = state.item) {
  const writerNotesContract = parseFieldPackContractFromWriterNotes(fieldPack?.writer_notes);
  const writerCoreFacts = writerNotesContract?.core_factual_fields && typeof writerNotesContract.core_factual_fields === "object" && !Array.isArray(writerNotesContract.core_factual_fields)
    ? writerNotesContract.core_factual_fields
    : {};
  const writerCta = writerNotesContract?.cta_contact && typeof writerNotesContract.cta_contact === "object" && !Array.isArray(writerNotesContract.cta_contact)
    ? writerNotesContract.cta_contact
    : writerNotesContract?.cta && typeof writerNotesContract.cta === "object" && !Array.isArray(writerNotesContract.cta)
      ? writerNotesContract.cta
      : writerNotesContract?.contact && typeof writerNotesContract.contact === "object" && !Array.isArray(writerNotesContract.contact)
        ? writerNotesContract.contact
        : {};
  const writerCuration = writerNotesContract?.curation_fields && typeof writerNotesContract.curation_fields === "object" && !Array.isArray(writerNotesContract.curation_fields)
    ? writerNotesContract.curation_fields
    : {};
  const publishableSource = fieldPack?.publishable_source && typeof fieldPack.publishable_source === "object" && !Array.isArray(fieldPack.publishable_source)
    ? fieldPack.publishable_source
    : {};
  const sourceSnapshot = fieldPack?.source_snapshot_json && typeof fieldPack.source_snapshot_json === "object" && !Array.isArray(fieldPack.source_snapshot_json)
    ? fieldPack.source_snapshot_json
    : {};
  const cleanContext = fieldPack?.clean_context && typeof fieldPack.clean_context === "object" && !Array.isArray(fieldPack.clean_context)
    ? fieldPack.clean_context
    : {};
  const cleanContextItem = cleanContext?.item && typeof cleanContext.item === "object" && !Array.isArray(cleanContext.item)
    ? cleanContext.item
    : {};
  const itemSource = item && typeof item === "object" && !Array.isArray(item) ? item : {};
  return {
    writerNotesContract,
    writerCoreFacts,
    writerCta,
    writerCuration,
    publishableSource,
    sourceSnapshot,
    cleanContext,
    cleanContextItem,
    itemSource,
  };
}

function readGuidanceAliasValue(source, aliases = []) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const path = String(alias || "").trim();
    if (!path) continue;
    const segments = path.split(".").filter(Boolean);
    let cursor = source;
    let resolved = true;
    for (const segment of segments) {
      if (!cursor || typeof cursor !== "object" || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
        resolved = false;
        break;
      }
      cursor = cursor[segment];
    }
    if (resolved) return cursor;
  }
  return null;
}

function normalizeGuidanceDisplayValue(value, key = "") {
  if (value == null) return "";
  if (Array.isArray(value)) {
    const items = value
      .map((entry) => normalizeGuidanceDisplayValue(entry, key))
      .filter((entry) => entry !== "");
    return items.join("; ");
  }
  if (typeof value === "boolean") {
    if (key === "open_now") return value ? "Open now: yes" : "Open now: no";
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "value")) return normalizeGuidanceDisplayValue(value.value, key);
    if (Object.prototype.hasOwnProperty.call(value, "text")) return normalizeGuidanceDisplayValue(value.text, key);
    if (Object.prototype.hasOwnProperty.call(value, "label")) return normalizeGuidanceDisplayValue(value.label, key);
    if (Object.prototype.hasOwnProperty.call(value, "name")) return normalizeGuidanceDisplayValue(value.name, key);
    if (Object.prototype.hasOwnProperty.call(value, "url")) return normalizeGuidanceDisplayValue(value.url, key);
    if (key === "opening_hours_note" || Object.prototype.hasOwnProperty.call(value, "open_now") || Object.prototype.hasOwnProperty.call(value, "weekday_text") || Object.prototype.hasOwnProperty.call(value, "opening_hours_weekday_text")) {
      const parts = [];
      const openNow = normalizeGuidanceDisplayValue(value.open_now, "open_now");
      if (openNow) parts.push(openNow);
      const weekdayText = normalizeGuidanceDisplayValue(value.weekday_text || value.opening_hours_weekday_text, "opening_hours_weekday_text");
      if (weekdayText) parts.push(weekdayText);
      const businessStatus = normalizeGuidanceDisplayValue(value.business_status, "business_status");
      if (businessStatus) parts.push(`Status: ${businessStatus}`);
      return parts.join("; ");
    }
    return "";
  }
  const text = String(value || "").trim();
  return text;
}

function extractVerifiedFactValue(verifiedFacts = [], aliases = []) {
  for (const fact of Array.isArray(verifiedFacts) ? verifiedFacts : []) {
    const raw = String(fact || "").trim();
    if (!raw) continue;
    const separatorIndex = raw.indexOf(":");
    if (separatorIndex <= 0) continue;
    const factKey = raw.slice(0, separatorIndex).trim().toLowerCase();
    const factValue = raw.slice(separatorIndex + 1).trim();
    if (!factValue) continue;
    if ((Array.isArray(aliases) ? aliases : []).some((alias) => {
      const terminalKey = String(alias || "").trim().toLowerCase().split(".").pop();
      return terminalKey && (factKey === terminalKey || factKey === terminalKey.replace(/_/g, " "));
    })) {
      return factValue;
    }
  }
  return "";
}

function extractThaiPhoneCandidate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const match = text.match(/(?:\+66[-\s]?)?(?:0\d{1,2}[-\s]?\d{3}[-\s]?\d{4}|\d{9,10})/);
  return match ? String(match[0]).trim() : "";
}

function collectGuidanceReferenceUrls(references = []) {
  const out = {
    facebook_url: "",
    map_url: "",
  };
  for (const row of Array.isArray(references) ? references : []) {
    const url = String(row?.url || row?.source_url || row?.evidence_source_url || "").trim();
    if (!url) continue;
    const normalizedUrl = url.toLowerCase();
    if (!out.facebook_url && normalizedUrl.includes("facebook.com")) out.facebook_url = url;
    if (!out.map_url && (normalizedUrl.includes("maps.google.") || normalizedUrl.includes("google.com/maps") || normalizedUrl.includes("goo.gl/maps"))) {
      out.map_url = url;
    }
  }
  return out;
}

function resolveGuidanceRowValue({
  key = "",
  label = "",
  aliases = [],
  fieldPack = {},
  item = state.item,
  confirmedValue = null,
  fieldReturn = null,
  cleanCandidates = [],
  requestedCheck = null,
  verifiedFacts = [],
  fallbackStatus = "unknown",
}) {
  const normalizedKey = String(key || "").trim().toLowerCase();
  const normalizedLabel = String(label || "").trim() || taxonomyFieldLabel(normalizedKey);
  const confirmedCandidate = normalizeRequestedCheckCandidate(confirmedValue);
  if (hasRequestedCheckMeaningfulValue(confirmedCandidate.value)) {
    return buildRequestedCheckStatusRow(normalizedKey, normalizedLabel, normalizeGuidanceDisplayValue(confirmedCandidate.value, normalizedKey), ["confirmed"]);
  }

  if (fieldReturn?.found && hasRequestedCheckMeaningfulValue(fieldReturn.value)) {
    return buildRequestedCheckStatusRow(normalizedKey, normalizedLabel, normalizeGuidanceDisplayValue(fieldReturn.value, normalizedKey), ["found"]);
  }
  if (fieldReturn?.checked) {
    const displayValue = normalizeGuidanceDisplayValue(fieldReturn.value, normalizedKey);
    return buildRequestedCheckStatusRow(
      normalizedKey,
      normalizedLabel,
      displayValue,
      displayValue ? ["found", "needs verification"] : ["needs verification"]
    );
  }

  for (const candidate of Array.isArray(cleanCandidates) ? cleanCandidates : []) {
    const candidateValue = candidate && typeof candidate === "object" && !Array.isArray(candidate) && Object.prototype.hasOwnProperty.call(candidate, "value")
      ? candidate.value
      : candidate;
    const candidateStatus = candidate && typeof candidate === "object" && !Array.isArray(candidate) && Array.isArray(candidate.statuses)
      ? candidate.statuses.filter(Boolean)
      : ["ai filled"];
    const displayValue = normalizeGuidanceDisplayValue(candidateValue, normalizedKey);
    const normalizedValue = String(displayValue || "").trim().toLowerCase();
    if (!displayValue) continue;
    if (normalizedValue === "unknown" || normalizedValue === "null") continue;
    return buildRequestedCheckStatusRow(normalizedKey, normalizedLabel, displayValue, candidateStatus);
  }

  const verifiedFactValue = extractVerifiedFactValue(verifiedFacts, aliases);
  if (verifiedFactValue) {
    return buildRequestedCheckStatusRow(normalizedKey, normalizedLabel, verifiedFactValue, ["found", "verified"]);
  }

  if (requestedCheck?.requested === true) {
    return buildRequestedCheckStatusRow(normalizedKey, normalizedLabel, null, ["needs verification"]);
  }

  return buildRequestedCheckStatusRow(normalizedKey, normalizedLabel, null, [fallbackStatus]);
}

function getCompactGuidanceLabel(key, fallbackLabel = "") {
  const normalizedKey = String(key || "").trim().toLowerCase();
  const englishCtaLabels = {
    phone: "Phone",
    line_url: "LINE URL",
    facebook_url: "Facebook URL",
    website_url: "Website URL",
    primary_cta: "Primary CTA",
  };
  return englishCtaLabels[normalizedKey] || String(fallbackLabel || "").trim() || normalizedKey || "-";
}

function normalizeItemGuidanceToken(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveItemGuidanceScope(fieldPack = {}, item = state.item) {
  const itemType = normalizeItemGuidanceToken(fieldPack?.content_type || item?.type);
  const category = normalizeItemGuidanceToken(fieldPack?.category || fieldPack?.item_category || item?.category);
  const hotelCategories = new Set(["hotels", "hotel", "stay", "stays", "lodging", "accommodation", "resort"]);
  const restaurantCategories = new Set(["cafes", "cafe", "restaurants", "restaurant", "food", "dining"]);
  const attractionCategories = new Set(["attractions", "attraction", "activities", "activity", "landmark", "landmarks", "temple", "museum", "market", "transport"]);
  return {
    itemType,
    category,
    isEvent: itemType === "event" || category === "event" || category === "events",
    isHotel: hotelCategories.has(category),
    isRestaurant: restaurantCategories.has(category),
    isAttractionPlace: itemType === "place" && attractionCategories.has(category),
    isUnknownCategory: !category,
  };
}

function isTaxonomyConfigRelevantForScope(sectionKey, scope = {}) {
  const normalizedSectionKey = String(sectionKey || "").trim().toLowerCase();
  if (normalizedSectionKey === "universal_curation_profile" || normalizedSectionKey === "practical_profile") return true;
  if (scope?.isUnknownCategory) return false;
  if (normalizedSectionKey === "event_profile") return scope?.isEvent === true;
  if (normalizedSectionKey === "hotel_profile") return scope?.isHotel === true;
  if (normalizedSectionKey === "restaurant_profile") return scope?.isRestaurant === true;
  if (normalizedSectionKey === "place_profile") return scope?.isAttractionPlace === true;
  return false;
}

function extractVerifiedFactSignals(verifiedFacts = [], rowConfigs = []) {
  const normalizedRows = (Array.isArray(rowConfigs) ? rowConfigs : []).map((row) => {
    const key = String(row?.key || "").trim().toLowerCase();
    const label = String(row?.label || "").trim().toLowerCase();
    const aliases = Array.isArray(row?.aliases) ? row.aliases.map((alias) => String(alias || "").trim().toLowerCase()).filter(Boolean) : [];
    return { key, label, aliases };
  }).filter((row) => row.key);
  const matchedKeys = new Set();
  const unmatchedFacts = [];

  for (const fact of Array.isArray(verifiedFacts) ? verifiedFacts : []) {
    const raw = String(fact || "").trim();
    if (!raw) continue;
    const normalizedFact = raw.toLowerCase();
    const matchedRow = normalizedRows.find((row) => {
      const candidates = [row.key, row.label, ...row.aliases].filter(Boolean);
      return candidates.some((candidate) => normalizedFact.startsWith(`${candidate}:`));
    });
    if (matchedRow) {
      matchedKeys.add(matchedRow.key);
      continue;
    }
    unmatchedFacts.push(raw);
  }

  return {
    matchedKeys,
    unmatchedFacts,
  };
}

function buildTaxonomyGuidanceRows(fieldPack = {}, requestedChecks = [], item = state.item) {
  const aiTaxonomy = fieldPack?.ai_taxonomy_json && typeof fieldPack.ai_taxonomy_json === "object"
    ? fieldPack.ai_taxonomy_json
    : {};
  const confirmedTaxonomy = fieldPack?.confirmed_taxonomy_json && typeof fieldPack.confirmed_taxonomy_json === "object"
    ? fieldPack.confirmed_taxonomy_json
    : {};
  const contract = parseTaxonomyContract(parseFieldPackContractFromWriterNotes(fieldPack.writer_notes));
  const verification = contract?.verification && typeof contract.verification === "object" ? contract.verification : {};
  const verifiedFacts = toReviewList(verification.verified_facts);
  const needsVerificationSet = new Set(toReviewList(verification.needs_verification));
  const publishBlockerSet = new Set(toReviewList(verification.publish_blockers));
  const scope = resolveItemGuidanceScope(fieldPack, item);
  const fieldReturnTaxonomy = fieldPack?.field_return_payload_json?.taxonomy_return && typeof fieldPack.field_return_payload_json.taxonomy_return === "object"
    ? fieldPack.field_return_payload_json.taxonomy_return
    : {};
  const requestedTaxonomyChecks = (Array.isArray(requestedChecks) ? requestedChecks : []).filter((check) => {
    const key = String(check?.key || "").trim().toLowerCase();
    return check?.requested === true && (key === "category" || key === "subtype" || key === "tags");
  });
  const taxonomySectionConfigs = [
    ["universal_curation_profile", ["highlights", "good_to_know", "why_visit", "recommended_for", "best_for", "nearby", "local_notes"]],
    ["practical_profile", ["price_range", "parking", "pet_friendly", "family_friendly", "accessibility", "opening_hours_note", "reservation_needed"]],
    ["place_profile", ["view_type", "atmosphere", "photo_spots", "visit_duration", "best_time_to_visit"]],
    ["restaurant_profile", ["restaurant_features", "signature_menu", "cuisine_type", "price_signals", "service_style", "seating_vibe"]],
    ["hotel_profile", ["hotel_amenities", "room_type_hints", "checkin_checkout", "booking_channels", "nearby_landmarks", "stay_best_for"]],
    ["event_profile", ["event_date_hints", "schedule_hints", "ticket_hints", "venue_notes", "event_best_for"]],
  ];
  const scopedImportantKeys = new Set([
    "category",
    "subtype",
    "tags",
    "parking",
    "pet_friendly",
    "family_friendly",
    "price_range",
    "opening_hours_note",
    "nearby",
    "accessibility",
    "confidence",
  ]);
  const sourceObjects = getGuidanceSourceObjects(fieldPack, item);
  const referencesByUse = collectGuidanceReferenceUrls(fieldPack?.references);
  const taxonomyAliases = {
    category: ["category", "type.category"],
    subtype: ["subtype", "type.subtype"],
    tags: ["tags", "publishableSource.tags"],
    opening_hours_note: [
      "opening_hours_note",
      "opening_hours",
      "business_status",
      "open_now",
      "current_opening_hours",
      "weekday_text",
      "opening_hours_weekday_text",
    ],
    nearby: ["nearby", "nearby_landmarks", "local_notes"],
    confidence: ["confidence"],
  };

  const knownKeys = new Set([
    ...Object.keys(aiTaxonomy || {}),
    ...Object.keys(confirmedTaxonomy || {}),
    ...Object.keys(fieldReturnTaxonomy || {}),
    ...requestedTaxonomyChecks.map((check) => String(check.key || "").trim().toLowerCase()),
  ]);
  taxonomySectionConfigs.forEach(([sectionKey, fields]) => {
    const source = contract?.[sectionKey] && typeof contract[sectionKey] === "object" ? contract[sectionKey] : {};
    Object.keys(source).forEach((key) => knownKeys.add(key));
  });
  Object.keys(sourceObjects.writerCoreFacts).forEach((key) => knownKeys.add(String(key || "").trim().toLowerCase()));
  Object.keys(sourceObjects.writerCuration).forEach((key) => knownKeys.add(String(key || "").trim().toLowerCase()));
  Object.entries(taxonomyAliases).forEach(([key, aliases]) => {
    const found = aliases.some((alias) => {
      const terminalAlias = String(alias || "").trim();
      if (!terminalAlias) return false;
      return [
        sourceObjects.publishableSource,
        sourceObjects.sourceSnapshot,
        sourceObjects.cleanContext,
        sourceObjects.cleanContextItem,
        sourceObjects.writerCoreFacts,
        sourceObjects.writerCuration,
      ].some((source) => readGuidanceAliasValue(source, [terminalAlias]) != null);
    });
    if (found) knownKeys.add(key);
  });
  if (contract && (scope?.isAttractionPlace || scope?.isRestaurant || scope?.isHotel || scope?.isEvent || scope?.isUnknownCategory)) {
    ["category", "opening_hours_note", "nearby", "confidence"].forEach((key) => knownKeys.add(key));
  }
  if (scope?.isAttractionPlace || scope?.isRestaurant || scope?.isHotel || scope?.isEvent || scope?.isUnknownCategory) {
    scopedImportantKeys.forEach((key) => {
      if (needsVerificationSet.has(key) || publishBlockerSet.has(key)) knownKeys.add(key);
    });
  }
  const verifiedFactSignals = extractVerifiedFactSignals(
    verifiedFacts,
    Array.from(knownKeys).map((key) => ({ key, label: taxonomyFieldLabel(key) }))
  );

  return Array.from(knownKeys)
    .filter(Boolean)
    .map((key) => {
      const normalizedKey = String(key || "").trim().toLowerCase();
      const fieldReturn = fieldReturnTaxonomy[normalizedKey] && typeof fieldReturnTaxonomy[normalizedKey] === "object"
        ? fieldReturnTaxonomy[normalizedKey]
        : null;
      const confirmedValue = confirmedTaxonomy[normalizedKey];
      const requestedCheck = requestedTaxonomyChecks.find((check) => String(check?.key || "").trim().toLowerCase() === normalizedKey) || null;
      const aliases = [normalizedKey, ...(taxonomyAliases[normalizedKey] || [])];
      const cleanCandidates = [];
      for (const [sectionKey] of taxonomySectionConfigs) {
        const source = contract?.[sectionKey] && typeof contract[sectionKey] === "object" ? contract[sectionKey] : {};
        if (Object.prototype.hasOwnProperty.call(source, normalizedKey)) {
          cleanCandidates.push({
            value: source[normalizedKey],
            statuses: verifiedFactSignals.matchedKeys.has(normalizedKey)
              ? ["found", "verified"]
              : (needsVerificationSet.has(normalizedKey) || publishBlockerSet.has(normalizedKey) ? ["suggested", "needs verification"] : ["suggested"]),
          });
        }
      }
      if (Object.prototype.hasOwnProperty.call(aiTaxonomy, normalizedKey)) {
        cleanCandidates.push({
          value: aiTaxonomy[normalizedKey],
          statuses: hasRequestedCheckMeaningfulValue(aiTaxonomy[normalizedKey]) ? ["ai filled", "needs verification"] : ["unknown"],
        });
      }
      if (normalizedKey === "opening_hours_note") {
        const openingHoursComposite = {
          open_now: readGuidanceAliasValue(sourceObjects.publishableSource, ["open_now"]) ?? readGuidanceAliasValue(sourceObjects.sourceSnapshot, ["open_now"]) ?? readGuidanceAliasValue(sourceObjects.cleanContextItem, ["open_now"]) ?? readGuidanceAliasValue(sourceObjects.writerCoreFacts, ["open_now"]) ?? readGuidanceAliasValue(sourceObjects.writerCuration, ["open_now"]),
          weekday_text: readGuidanceAliasValue(sourceObjects.publishableSource, ["weekday_text", "opening_hours_weekday_text"])
            ?? readGuidanceAliasValue(sourceObjects.sourceSnapshot, ["weekday_text", "opening_hours_weekday_text"])
            ?? readGuidanceAliasValue(sourceObjects.cleanContextItem, ["weekday_text", "opening_hours_weekday_text"])
            ?? readGuidanceAliasValue(sourceObjects.writerCoreFacts, ["weekday_text", "opening_hours_weekday_text"])
            ?? readGuidanceAliasValue(sourceObjects.writerCuration, ["weekday_text", "opening_hours_weekday_text"]),
          business_status: readGuidanceAliasValue(sourceObjects.publishableSource, ["business_status"])
            ?? readGuidanceAliasValue(sourceObjects.sourceSnapshot, ["business_status"])
            ?? readGuidanceAliasValue(sourceObjects.cleanContextItem, ["business_status"])
            ?? readGuidanceAliasValue(sourceObjects.writerCoreFacts, ["business_status"])
            ?? readGuidanceAliasValue(sourceObjects.writerCuration, ["business_status"]),
        };
        if (openingHoursComposite.open_now != null || openingHoursComposite.weekday_text != null || openingHoursComposite.business_status != null) {
          cleanCandidates.unshift({ value: openingHoursComposite, statuses: ["ai filled"] });
        }
      }
      [
        sourceObjects.publishableSource,
        sourceObjects.sourceSnapshot,
        sourceObjects.cleanContext,
        sourceObjects.cleanContextItem,
        sourceObjects.writerCoreFacts,
        sourceObjects.writerCuration,
      ].forEach((source) => {
        const aliasValue = readGuidanceAliasValue(source, aliases);
        if (aliasValue != null) cleanCandidates.push({ value: aliasValue, statuses: ["ai filled"] });
      });

      const resolvedRow = resolveGuidanceRowValue({
        key: normalizedKey,
        label: taxonomyFieldLabel(normalizedKey),
        aliases,
        fieldPack,
        item,
        confirmedValue,
        fieldReturn,
        cleanCandidates,
        requestedCheck,
        verifiedFacts,
        fallbackStatus: "unknown",
      });
      if (!resolvedRow.value && (needsVerificationSet.has(normalizedKey) || publishBlockerSet.has(normalizedKey))) {
        const tone = resolvedRow.statuses.includes("unknown") ? ["unknown", "needs verification"] : ["needs verification"];
        return buildRequestedCheckStatusRow(normalizedKey, taxonomyFieldLabel(normalizedKey), null, tone);
      }
      if (resolvedRow.value && (needsVerificationSet.has(normalizedKey) || publishBlockerSet.has(normalizedKey)) && !resolvedRow.statuses.includes("found") && !resolvedRow.statuses.includes("confirmed")) {
        return buildRequestedCheckStatusRow(normalizedKey, taxonomyFieldLabel(normalizedKey), resolvedRow.value, [...resolvedRow.statuses, "needs verification"]);
      }
      return resolvedRow;
    })
    .filter((row) => {
      if (!row.statuses.length) return false;
      if (row.value) return true;
      if (row.statuses.includes("missing") || row.statuses.includes("unknown")) return true;
      if (row.key === "confidence" && row.statuses.includes("unknown")) return true;
      if (row.statuses.includes("needs verification")) return true;
      if (row.statuses.includes("found") || row.statuses.includes("confirmed") || row.statuses.includes("verified")) return true;
      if (row.statuses.includes("suggested")) return true;
      return false;
    });
}

function buildRequestedChecksCompactSummaryData(fieldPack = {}, groups = [], item = state.item) {
  const selectedChecks = groups.flatMap((group) => (Array.isArray(group?.checks) ? group.checks : []).filter((check) => check?.requested === true));
  const articleContextHints = extractRequestedCheckArticleContextHints(groups);
  const isPlaceItem = isPlaceRequestedCheckItem(item);
  const aiTaxonomy = fieldPack?.ai_taxonomy_json && typeof fieldPack.ai_taxonomy_json === "object"
    ? fieldPack.ai_taxonomy_json
    : {};
  const ctaTemplateChecks = REQUESTED_CHECK_GROUP_TEMPLATES.find((group) => group.group_key === "cta_contact")?.checks || [];
  const fieldReturnCta = fieldPack?.field_return_payload_json?.cta_return && typeof fieldPack.field_return_payload_json.cta_return === "object"
    ? fieldPack.field_return_payload_json.cta_return
    : {};
  const sourceObjects = getGuidanceSourceObjects(fieldPack, item);
  const referencesByUse = collectGuidanceReferenceUrls(fieldPack?.references);
  const ctaAliases = {
    phone: ["phone", "phone_number", "telephone", "tel", "contact.phone", "cta.phone", "national_phone_number", "international_phone_number"],
    facebook_url: ["facebook_url", "facebook", "facebookUrl", "contact.facebook_url", "cta.facebook_url"],
    line_url: ["line_url", "line", "lineUrl", "contact.line_url", "cta.line_url"],
    website_url: ["website_url", "website", "websiteUrl", "contact.website_url", "cta.website_url", "source_url"],
    primary_cta: ["primary_cta", "cta.primary_cta", "map_url", "location_url"],
  };

  const ctaRows = isPlaceItem
    ? ctaTemplateChecks.map((check) => {
      const key = check.key;
      const fieldReturn = fieldReturnCta[key] && typeof fieldReturnCta[key] === "object" ? fieldReturnCta[key] : null;
      const confirmedValue = normalizeRequestedCheckCandidate(fieldPack?.confirmed_cta_contact_json?.[key]);
      const curatedValue = normalizeRequestedCheckCandidate(fieldPack?.curated_cta_contact_json?.[key]);
      const aiValue = normalizeRequestedCheckCandidate(fieldPack?.ai_cta_contact_json?.[key]);
      const compactLabel = getCompactGuidanceLabel(key, check.label);
      const aliases = [key, ...(ctaAliases[key] || [])];
      const cleanCandidates = [];
      if (hasRequestedCheckMeaningfulValue(curatedValue.value)) {
        cleanCandidates.push({ value: curatedValue.value, statuses: ["suggested"] });
      }
      if (hasRequestedCheckMeaningfulValue(aiValue.value)) {
        cleanCandidates.push({
          value: aiValue.value,
          statuses: aiValue.found ? ["found"] : ["ai filled", "needs verification"],
        });
      }
      [
        sourceObjects.publishableSource,
        sourceObjects.sourceSnapshot,
        sourceObjects.cleanContext,
        sourceObjects.cleanContextItem,
        sourceObjects.itemSource,
        sourceObjects.writerCoreFacts,
        sourceObjects.writerCta,
      ].forEach((source) => {
        const aliasValue = readGuidanceAliasValue(source, aliases);
        if (aliasValue != null) cleanCandidates.push({ value: aliasValue, statuses: ["ai filled", "needs verification"] });
      });
      if (key === "facebook_url" && referencesByUse.facebook_url) {
        cleanCandidates.push({ value: referencesByUse.facebook_url, statuses: ["suggested"] });
      }
      if (key === "phone") {
        const phoneFromFacts = extractThaiPhoneCandidate(
          [
            ...toReviewList(sourceObjects.writerNotesContract?.verification?.verified_facts),
            String(fieldPack?.writer_notes || ""),
          ].join(" | ")
        );
        if (phoneFromFacts) cleanCandidates.push({ value: phoneFromFacts, statuses: ["found", "verified"] });
      }
      if (key === "primary_cta" && referencesByUse.map_url) {
        cleanCandidates.unshift({ value: "map", statuses: ["suggested"] });
      }
      if (key === "primary_cta") {
        const mapCandidate = cleanCandidates.find((candidate) => String(normalizeGuidanceDisplayValue(candidate?.value, key) || "").trim());
        if (mapCandidate && !hasRequestedCheckMeaningfulValue(confirmedValue.value) && !fieldReturn?.found) {
          cleanCandidates.unshift({ value: "map", statuses: ["suggested"] });
        }
      }
      const requestedCheck = selectedChecks.find((selected) => String(selected?.key || "").trim().toLowerCase() === key) || null;
      const resolvedRow = resolveGuidanceRowValue({
        key,
        label: compactLabel,
        aliases,
        fieldPack,
        item,
        confirmedValue: confirmedValue.value,
        fieldReturn,
        cleanCandidates,
        requestedCheck,
        verifiedFacts: [],
        fallbackStatus: "missing",
      });
      if (!resolvedRow.value && (fieldReturn?.checked || fieldReturn?.found || confirmedValue.checked || confirmedValue.found || curatedValue.checked || curatedValue.found || aiValue.checked || aiValue.found)) {
        return buildRequestedCheckStatusRow(key, compactLabel, null, ["needs verification"]);
      }
      return resolvedRow;
    })
    : [];
  const scope = resolveItemGuidanceScope(fieldPack, item);
  const rawTaxonomyRows = buildTaxonomyGuidanceRows(
    fieldPack,
    groups.flatMap((group) => Array.isArray(group?.checks) ? group.checks : []),
    item
  );
  const hiddenMetadataKeys = new Set(["title", "type", "slug", "map_url", "google_place_id", "source_url", "latitude", "longitude"]);
  const unresolvedRestaurantWhitelist = new Set([
    "price_range",
    "parking",
    "pet_friendly",
    "family_friendly",
    "accessibility",
    "signature_menu",
    "price_signals",
    "service_style",
  ]);
  const alwaysVisibleMeaningfulKeys = new Set([
    "category",
    "opening_hours_note",
    "nearby",
    "nearby_landmarks",
    "price_range",
    "parking",
    "pet_friendly",
    "family_friendly",
    "accessibility",
    "signature_menu",
    "price_signals",
    "service_style",
  ]);
  const hiddenLowValueKeys = new Set([
    "subtype",
    "tags",
    "source",
    "confidence",
    "note",
    "highlights",
    "good_to_know",
    "why_visit",
    "recommended_for",
    "best_for",
    "local_notes",
    "reservation_needed",
    "view_type",
    "atmosphere",
    "photo_spots",
    "visit_duration",
    "best_time_to_visit",
    "restaurant_features",
    "cuisine_type",
    "seating_vibe",
    "stay_best_for",
    "event_date_hints",
    "schedule_hints",
    "ticket_hints",
    "venue_notes",
    "event_best_for",
    "hotel_amenities",
    "room_type_hints",
    "checkin_checkout",
    "booking_channels",
  ]);
  const taxonomyRows = rawTaxonomyRows
    .map((row) => {
      const normalizedStatuses = row.statuses.includes("needs verification")
        ? row.statuses.filter((status) => status !== "unknown")
        : row.statuses;
      return {
        ...row,
        statuses: normalizedStatuses.length ? normalizedStatuses : row.statuses,
      };
    })
    .filter((row) => {
      const key = String(row.key || "").trim().toLowerCase();
      const hasValue = hasRequestedCheckMeaningfulValue(row.value);
      const needsVerification = row.statuses.includes("needs verification");
      if (hiddenMetadataKeys.has(key)) return false;
      if (scope?.isRestaurant || scope?.isAttractionPlace) {
        if (hiddenLowValueKeys.has(key)) return false;
        if (hasValue && !alwaysVisibleMeaningfulKeys.has(key)) return false;
        if (!hasValue && unresolvedRestaurantWhitelist.has(key)) return true;
        if (!hasValue && needsVerification && (key === "nearby" || key === "nearby_landmarks")) return true;
        if (!hasValue && (key === "category" || key === "opening_hours_note")) return true;
        if (!hasValue) return false;
        if ((key.startsWith("hotel_") || key.startsWith("event_") || key === "room_type_hints" || key === "checkin_checkout" || key === "booking_channels") && !hasValue) return false;
      }
      return hasValue || needsVerification || key === "category" || key === "opening_hours_note" || key === "nearby" || key === "nearby_landmarks";
    });
  const taxonomyContract = parseTaxonomyContract(parseFieldPackContractFromWriterNotes(fieldPack.writer_notes));
  const taxonomyVerification = taxonomyContract?.verification && typeof taxonomyContract.verification === "object"
    ? taxonomyContract.verification
    : {};
  const verifiedFacts = toReviewList(taxonomyContract?.verification?.verified_facts);
  const needsVerificationFacts = toReviewList(taxonomyVerification.needs_verification);
  const publishBlockers = toReviewList(taxonomyVerification.publish_blockers);
  const verifiedFactSignals = extractVerifiedFactSignals(
    verifiedFacts,
    taxonomyRows.map((row) => ({ key: row.key, label: row.label }))
  );

  return {
    ctaRows,
    ctaMutedNote: isPlaceItem ? "" : "CTA Review applies to place items only.",
    taxonomyRows,
    taxonomyEvidence: {
      verifiedFacts,
      needsVerificationFacts,
      publishBlockers,
      unmatchedVerifiedFacts: verifiedFactSignals.unmatchedFacts,
      aiTaxonomy,
      fieldReturnTaxonomy: fieldPack?.field_return_payload_json?.taxonomy_return && typeof fieldPack.field_return_payload_json.taxonomy_return === "object"
        ? fieldPack.field_return_payload_json.taxonomy_return
        : {},
      contract: taxonomyContract,
    },
    selectedChecks,
    articleContextHints: articleContextHints
      .filter((hint) => {
        const normalized = String(hint || "").trim().toLowerCase();
        return normalized && !/(confirm phone|confirm facebook|confirm website|confirm line|confirm primary cta|need phone|need facebook|need website|need line|need cta|ขอเบอร์ที่ติดต่อได้จริง|ถ้ามีให้ขอลิงก์ที่ใช้ได้จริง|ถ้ามีให้ขอลิงก์เพจที่ถูกต้อง|ถ้ามีให้ขอลิงก์เว็บไซต์หลัก|ยืนยันว่าควรพาคนไปกดอะไรเป็นหลัก)/i.test(normalized);
      })
      .filter((hint, index, list) => list.findIndex((entry) => String(entry || "").trim().toLowerCase() === String(hint || "").trim().toLowerCase()) === index)
      .slice(0, 5),
  };
}

function truncateRequestedGuidanceValue(value, maxLen = 72) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3).trimEnd() + "...";
}

function renderRequestedCheckCompactRows(rows = [], options = {}) {
  const useGrid = options.useGrid === true;
  return rows.map((row) => `
    <div class="${useGrid ? "summary-row requested-guidance-row" : "summary-row"}">
      <strong>${escapeHtml(row.label)}</strong>
      <span class="${useGrid ? "requested-guidance-value" : ""}">${row.value ? `<span title="${escapeHtml(row.value)}">${escapeHtml(truncateRequestedGuidanceValue(row.value))}</span> ` : '<span class="muted">No value</span> '}${row.statuses.map((status) => getRequestedCheckStatusBadge(status, status === "found" || status === "confirmed" ? "ok" : status === "missing" || status === "unknown" || status === "needs verification" ? "warning" : "neutral")).join(" ")}</span>
    </div>
  `).join("");
}

function buildRequestedChecksGuidanceModel(fieldPack = {}, requestedChecks = { version: 1, groups: [] }, item = state.item) {
  const groups = Array.isArray(requestedChecks?.groups)
    ? filterRequestedCheckGroupsForItem(requestedChecks.groups, item)
    : getRequestedCheckEditorGroups(fieldPack, item);
  return buildRequestedChecksCompactSummaryData(fieldPack, groups, item);
}

function renderRequestedChecksGuidanceHtml(model = {}, options = {}) {
  const taxonomyEvidence = model.taxonomyEvidence && typeof model.taxonomyEvidence === "object" ? model.taxonomyEvidence : {};
  const hasTaxonomyEvidence = hasRequestedCheckMeaningfulValue(taxonomyEvidence.verifiedFacts)
    || hasRequestedCheckMeaningfulValue(taxonomyEvidence.needsVerificationFacts)
    || hasRequestedCheckMeaningfulValue(taxonomyEvidence.publishBlockers)
    || hasRequestedCheckMeaningfulValue(taxonomyEvidence.unmatchedVerifiedFacts)
    || hasRequestedCheckMeaningfulValue(taxonomyEvidence.aiTaxonomy)
    || hasRequestedCheckMeaningfulValue(taxonomyEvidence.fieldReturnTaxonomy)
    || hasRequestedCheckMeaningfulValue(taxonomyEvidence.contract);
  return `
    <div class="article-brief-doc">
      <section class="article-brief-section">
        <h3>AI guidance / curation review</h3>
        <div class="muted">ข้อมูลด้านล่างเป็นข้อเสนอจาก AI และหลักฐานที่ช่วยให้ editor ตรวจบริบทก่อนเขียนหรือส่งต่อ งานนี้ยังไม่ใช่การยืนยันเผยแพร่</div>
      </section>
      <section class="article-brief-section">
        <h3>CTA Review</h3>
        ${model.ctaMutedNote ? `<div class="muted">${escapeHtml(model.ctaMutedNote)}</div>` : `<div class="readiness-summary">${renderRequestedCheckCompactRows(model.ctaRows || [])}</div>`}
      </section>
      <section class="article-brief-section">
        <h3>Curation Review</h3>
        <div class="readiness-summary requested-guidance-grid">
          ${(Array.isArray(model.taxonomyRows) && model.taxonomyRows.length) ? renderRequestedCheckCompactRows(model.taxonomyRows, { useGrid: true }) : '<div class="summary-row"><strong>Status</strong><span class="muted">No taxonomy review signals available.</span></div>'}
        </div>
      </section>
      <section class="article-brief-section">
        <h3>Field Pack Guidance</h3>
        <div class="readiness-summary">
          <div class="summary-row"><strong>Suggested Focus</strong><span>${Array.isArray(model.selectedChecks) && model.selectedChecks.length ? model.selectedChecks.map((check) => getRequestedCheckStatusBadge(String(check.label || check.key || "").trim() || "-", "ok")).join(" ") : '<span class="muted">No suggested focus selected.</span>'}</span></div>
          <div class="summary-row"><strong>Article context</strong><span>${Array.isArray(model.articleContextHints) && model.articleContextHints.length ? escapeHtml(model.articleContextHints.slice(0, 5).join(" | ")) : '<span class="muted">No article context hints.</span>'}</span></div>
        </div>
      </section>
      ${hasTaxonomyEvidence
        ? `<section class="article-brief-section">
            <details class="secondary-panel">
              <summary>Source details</summary>
              <details class="secondary-panel">
                <summary>Debug JSON</summary>
                <pre>${escapeHtml(JSON.stringify({
                  verified_facts: taxonomyEvidence.verifiedFacts || [],
                  needs_verification: taxonomyEvidence.needsVerificationFacts || [],
                  publish_blockers: taxonomyEvidence.publishBlockers || [],
                  unmatched_verified_facts: taxonomyEvidence.unmatchedVerifiedFacts || [],
                  ai_taxonomy_json: taxonomyEvidence.aiTaxonomy || {},
                  field_return_taxonomy: taxonomyEvidence.fieldReturnTaxonomy || {},
                  taxonomy_contract: taxonomyEvidence.contract || {},
                }, null, 2))}</pre>
              </details>
            </details>
          </section>`
        : ""}
    </div>
  `;
}

function buildRequestedChecksCompactPreviewHtml(requestedChecks = { version: 1, groups: [] }, fieldPack = state.fieldPack || null, item = state.item) {
  const guidanceModel = buildRequestedChecksGuidanceModel(fieldPack || {}, requestedChecks, item);
  return renderRequestedChecksGuidanceHtml(guidanceModel);
}


function buildRequestedChecksEditorHtml(fieldPack = {}, item = state.item) {
  const groups = getRequestedCheckEditorGroups(fieldPack, item);
  const compactSummary = buildRequestedChecksGuidanceModel(fieldPack, { version: 1, groups }, item);
  return renderRequestedChecksGuidanceHtml(compactSummary);
}


function getDraftSelectedImageAssets() {
  return (Array.isArray(state.assets) ? state.assets : []).filter((row) => {
    const selected = Number(row?.selected_in_clean || 0) === 1 && String(row?.role || "") !== "unused";
    const mimeType = String(row?.mime_type || "").toLowerCase();
    return selected && (!mimeType || mimeType.startsWith("image/"));
  });
}

function renderFieldPackMediaHintEditor(fieldPack = null) {
  const root = qs("fp-media-hints-editor");
  if (!root) return;
  const packMediaHints = Array.isArray(fieldPack?.media_hints) ? fieldPack.media_hints : [];
  const byContentAssetId = new Map(
    packMediaHints
      .filter((row) => Number(row?.content_asset_id || 0) > 0)
      .map((row) => [Number(row.content_asset_id || 0), row])
  );
  const rows = getDraftSelectedImageAssets();
  if (!rows.length) {
    root.innerHTML = '<p class="muted">ยังไม่มีรูปที่เลือกไว้จาก draft สำหรับ media hints</p>';
    return;
  }

  root.classList.add("media-hint-editor");
  root.innerHTML = rows.map((asset) => {
    const contentAssetId = Number(asset.id || 0) || 0;
    const selectedHint = byContentAssetId.get(contentAssetId);
    const checked = Boolean(selectedHint);
    const defaultKind = String(asset.is_cover || asset.role === "cover" ? "cover" : asset.role === "gallery" ? "gallery" : "reference");
    const publicUrl = sanitizeUrl(asset.public_url || "");
    return `
      <div class="media-hint-row" data-content-asset-id="${contentAssetId}" data-public-url="${escapeHtml(publicUrl)}">
        <div class="media-hint-meta">
          ${publicUrl
            ? `<img class="asset-thumb media-hint-thumb" src="${escapeHtml(publicUrl)}" alt="รูปอ้างอิงสำหรับ hint" title="รูปอ้างอิงสำหรับ hint" />`
            : '<div class="media-hint-thumb media-hint-thumb-empty">ไม่มีรูป</div>'}
          <div class="media-hint-text">
            <label class="media-hint-inline">
              <input type="checkbox" class="fp-media-hint-selected" ${checked ? "checked" : ""} />
              <span class="media-hint-title">เลือกใช้รูปนี้ใน field pack</span>
            </label>
          </div>
        </div>
        <div>
          <label>kind</label>
          <select class="fp-media-hint-kind">
            <option value="cover" ${(selectedHint?.kind || defaultKind) === "cover" ? "selected" : ""}>cover</option>
            <option value="gallery" ${(selectedHint?.kind || defaultKind) === "gallery" ? "selected" : ""}>gallery</option>
            <option value="raw" ${(selectedHint?.kind || defaultKind) === "raw" ? "selected" : ""}>raw</option>
            <option value="reference" ${(selectedHint?.kind || defaultKind) === "reference" ? "selected" : ""}>reference</option>
          </select>
        </div>
        <div>
          <label>caption</label>
          <input class="fp-media-hint-caption" value="${escapeHtml(String(selectedHint?.caption || ""))}" placeholder="คำบรรยายสั้น ๆ ของภาพนี้" />
        </div>
      </div>
    `;
  }).join("");

  root.querySelectorAll("img.media-hint-thumb").forEach((img) => {
    const src = img.getAttribute("src") || "";
    setImageWithFallback(img, src);
    img.addEventListener("mouseenter", (event) => showAssetHoverPreview(src, event));
    img.addEventListener("mousemove", (event) => {
      const box = document.getElementById("asset-hover-preview");
      if (box && !box.classList.contains("hidden")) {
        positionAssetHoverPreview(box, event);
      }
    });
    img.addEventListener("mouseleave", hideAssetHoverPreview);
  });
}

// Step 4 copy contract:
// label: "พร้อมส่งเข้า handoff"
// help: "ใช้เมื่อ brief พร้อมแล้วและจบงานใน place step 4 พร้อมส่งต่อไป handoff"
// label: "ตั้งเป็นพร้อมส่งเข้า handoff"
// label: "กลับไปยังจัด brief"
// ยังไม่พร้อมส่งเข้า handoff
// พร้อมส่งเข้า handoff ได้ แต่ยังมีข้อแนะนำ
// ข้อแนะนำเพิ่มเติม
// ต้องเติมก่อนส่งเข้า handoff
// ต้องเปลี่ยนสถานะการเตรียมมอบหมายเป็น "พร้อมส่งเข้า handoff" ก่อน
// ต้องเปลี่ยนสถานะการเตรียมมอบหมายเป็น "พร้อมส่งเข้า handoff"
// ยังไปงานมอบหมายไม่ได้: ต้องเปลี่ยนสถานะการเตรียมมอบหมายเป็น "พร้อมส่งเข้า handoff" ก่อน
// ชุดงานนี้พร้อมส่งเข้า handoff แล้ว แต่ยังไม่ได้สร้างงานมอบหมาย
// สร้างงานมอบหมายแล้ว และติดตามงานต่อได้ในขั้นงานมอบหมาย
// งานนี้ยังอยู่ระหว่างจัด brief และยังไม่พร้อมส่งเข้า handoff
// มีงานมอบหมายอยู่ในรายการนี้แล้ว แต่ยังไม่ผูกกับชุดงานนี้
// โหลดข้อมูลงานมอบหมายไม่สำเร็จ
// โหลดข้อมูลงานมอบหมายไม่สำเร็จ จึงยังยืนยันสถานะงานต่อจากขั้นนี้ไม่ได้
// พร้อมส่งเข้า handoff จากชุดลงหน้านี้
// actionLabel = "ไปงานมอบหมาย";
// actionLabel = "ดูงานมอบหมาย";
// setStatus("กำลังบันทึกงานตรวจแก้และเข้าสู่กระบวนการส่งงานไปทำ...");
// setStatus(`ยังเข้าสู่กระบวนการส่งงานไปทำไม่ได้: ${err.message}`, true);
const STEP_FOUR_COPY_TOKENS = [
  "ต้องเปลี่ยนสถานะการเตรียมมอบหมายเป็น \"พร้อมส่งเข้า handoff\"",
  "พร้อมส่งเข้า handoff จากชุดลงหน้างานนี้",
  "มีงานมอบหมายอยู่ในรายการนี้แล้ว แต่ยังไม่ได้ผูกกับชุดงานนี้",
  "ยังไปงานมอบหมายไม่ได้: ต้องเปลี่ยนสถานะการเตรียมมอบหมายเป็น \"พร้อมส่งเข้า handoff\" ก่อน",
  "actionLabel = \"ไปงานมอบหมาย\";",
];
const LEGACY_READY_FOR_HANDOFF_STATUS = "ready_for_handoff";

function getFieldProgressSteps() {
  return [
    { value: "draft", label: "ร่าง brief", help: "ยังแก้ไขรายละเอียดใน brief ได้ตามปกติ" },
    { value: "ready_for_field", label: "พร้อมส่ง handoff", help: "สรุป brief พร้อมส่งต่อไปงานภาคสนาม (place step 4)" },
  ];
}

function getFieldProgressStatusLabel(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "draft") return "ร่าง brief";
  if (value === "ready_for_field" || value === LEGACY_READY_FOR_HANDOFF_STATUS) return "พร้อมส่ง handoff";
  if (value === "field_in_progress") return "กำลังทำภาคสนาม";
  if (value === "field_done") return "ภาคสนามเสร็จ";
  if (value === "on_hold") return "พักงาน";
  return "ร่าง brief";
}

function getFieldProgressActions(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "ready_for_field" || value === LEGACY_READY_FOR_HANDOFF_STATUS) {
    return [{ nextStatus: "draft", label: "ย้ายกลับเป็นร่าง brief", tone: "secondary" }];
  }
  if (value === "on_hold") {
    return [{ nextStatus: "ready_for_field", label: "กลับมาเป็นพร้อมส่ง handoff", tone: "primary" }];
  }
  if (value === "field_in_progress" || value === "field_done") {
    return [];
  }
  return [{ nextStatus: "ready_for_field", label: "เปลี่ยนเป็นพร้อมส่ง handoff", tone: "primary" }];
}

function renderFieldProgressControl() {
  const root = qs("fp-progress-control");
  const select = qs("fp-status");
  if (!root || !select) return;

  const status = String(select.value || "draft").trim().toLowerCase() || "draft";
  const steps = getFieldProgressSteps();
  const currentIndex = steps.findIndex((step) => step.value === status);
  const editGuard = getEditPermissionGuard();
  const actions = getFieldProgressActions(status);
  const executionNote = (status === "field_in_progress" || status === "field_done")
    ? '<div class="field-progress-note warn">สถานะปัจจุบันยังไม่พร้อมสำหรับการส่งต่อ</div>'
    : "";
  const onHoldNote = status === "on_hold"
    ? '<div class="field-progress-note warn">กรุณาทำข้อมูลให้ครบก่อนเดิน flow ไปขั้นที่ 4</div>'
    : "";

  root.innerHTML = `
    <div class="field-progress-steps" aria-label="field progress">
      ${steps.map((step, index) => {
        const stateClass = currentIndex === -1
          ? ""
          : index < currentIndex
            ? "completed"
            : index === currentIndex
              ? "active"
              : "";
        return `
          <div class="field-progress-step ${stateClass}">
            <span class="field-progress-dot">${index + 1}</span>
            <div class="field-progress-copy">
              <strong>${escapeHtml(step.label)}</strong>
              <span>${escapeHtml(step.help)}</span>
            </div>
          </div>
        `;
      }).join("")}
    </div>
    <div class="field-progress-current">
          <strong>สถานะปัจจุบัน:</strong> ${escapeHtml(getFieldProgressStatusLabel(status))}
    </div>
    ${executionNote}
    ${onHoldNote}
    <div class="field-progress-actions">
      ${actions.map((action) => `
        <button
          type="button"
          class="${action.tone === "primary" ? "primary" : "utility-action"}"
          data-action="set-field-progress"
          data-next-status="${escapeHtml(action.nextStatus)}"
          ${editGuard.allowed ? "" : "disabled"}
          title="${editGuard.allowed ? "" : escapeHtml(editGuard.reason)}"
        >${escapeHtml(action.label)}</button>
      `).join("")}
    </div>
  `;

  root.querySelectorAll("button[data-action='set-field-progress']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextStatus = String(btn.dataset.nextStatus || "").trim();
      if (!nextStatus || !select) return;
      const changed = select.value !== nextStatus;
      select.value = nextStatus;
      if (changed) {
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      renderFieldProgressControl();
    });
  });
}

function fillFieldPackForm(fieldPack = null) {
  const defaults = buildFieldPackDefaults();
  const pack = fieldPack || {};
  const checklists = Array.isArray(pack.checklists) ? pack.checklists : [];
  const mustVerifyFacts = listChecklistTexts(checklists.filter((row) => String(row.checklist_type || "") === "must_verify_fact"));
  const mustCaptureItems = buildMustCaptureEditorRowsFromChecklists(
    checklists,
    defaults.must_capture_shots || []
  );
  if (!mustCaptureItems.length && Array.isArray(defaults.must_capture_items) && defaults.must_capture_items.length) {
    mustCaptureItems.push(...defaults.must_capture_items);
  }
  const mustCaptureShots = mustCaptureItems.map((row) => String(row.item_text || "").trim()).filter(Boolean);
  const mustAskQuestions = listChecklistTexts(checklists.filter((row) => String(row.checklist_type || "") === "must_ask_question"));
  const fieldAssignment = buildAssignmentFormState("field", pack.assignments);
  const writerAssignment = buildAssignmentFormState("writer", pack.assignments);
  if (qs("fp-id")) qs("fp-id").value = pack.id ? String(pack.id) : "";
  if (qs("fp-status")) qs("fp-status").value = String(pack.status || defaults.status || "draft");
  if (qs("fp-writer-ready")) qs("fp-writer-ready").checked = Boolean(pack.writer_ready);
  if (qs("fp-ai-summary")) qs("fp-ai-summary").value = String(pack.ai_summary || defaults.ai_summary || "");
  if (qs("fp-editor-summary")) qs("fp-editor-summary").value = String(pack.editor_summary || "");
  if (qs("fp-story-angle")) qs("fp-story-angle").value = String(pack.story_angle || defaults.story_angle || "");
  if (qs("fp-field-notes")) qs("fp-field-notes").value = String(pack.field_notes || "");
  if (qs("fp-social-hook")) qs("fp-social-hook").value = String(pack.social_hook || defaults.social_hook || "");
  if (qs("fp-social-caption-angle")) qs("fp-social-caption-angle").value = String(pack.social_caption_angle || defaults.social_caption_angle || "");
  setLineListValue("fp-ai-highlights", pack.ai_highlights_json || defaults.ai_highlights || []);
  setLineListValue("fp-ai-unknowns", pack.ai_unknowns_json || defaults.ai_unknowns || []);
  setLineListValue("fp-verified-facts", pack.verified_facts_json || defaults.verified_facts || []);
  setLineListValue("fp-uncertain-facts", pack.uncertain_facts_json || defaults.uncertain_facts || []);
  setLineListValue("fp-must-verify-facts", mustVerifyFacts.length ? mustVerifyFacts : (defaults.must_verify_facts || []));
  setLineListValue("fp-must-capture-shots", mustCaptureShots);
  renderMustCaptureEditor(mustCaptureItems);
  setLineListValue("fp-must-ask-questions", mustAskQuestions.length ? mustAskQuestions : (defaults.must_ask_questions || []));
  setLineListValue("fp-social-shot-emphasis", pack.social_shot_emphasis_json || defaults.social_shot_emphasis || []);
  setLineListValue("fp-social-on-camera-points", pack.social_on_camera_points_json || defaults.social_on_camera_points || []);
  setLineListValue("fp-references", formatReferenceLines(pack.references, "general"));
  setLineListValue("fp-writer-references", formatReferenceLines(pack.references, "writer"));
  setLineListValue("fp-external-media-hints", formatExternalMediaHintLines(pack.media_hints));
  if (qs("fp-field-assignment-id")) qs("fp-field-assignment-id").value = fieldAssignment.linked_assignment_id ? String(fieldAssignment.linked_assignment_id) : "";
  if (qs("fp-field-assigned-name")) qs("fp-field-assigned-name").value = fieldAssignment.assigned_name;
  if (qs("fp-field-assigned-role")) qs("fp-field-assigned-role").value = fieldAssignment.assigned_role;
  if (qs("fp-field-due-at")) qs("fp-field-due-at").value = fieldAssignment.due_at;
  if (qs("fp-field-assignment-note")) qs("fp-field-assignment-note").value = fieldAssignment.note;
  if (qs("fp-writer-assignment-id")) qs("fp-writer-assignment-id").value = writerAssignment.linked_assignment_id ? String(writerAssignment.linked_assignment_id) : "";
  if (qs("fp-writer-assigned-name")) qs("fp-writer-assigned-name").value = writerAssignment.assigned_name;
  if (qs("fp-writer-assigned-role")) qs("fp-writer-assigned-role").value = writerAssignment.assigned_role;
  if (qs("fp-writer-due-at")) qs("fp-writer-due-at").value = writerAssignment.due_at;
  if (qs("fp-writer-assignment-note")) qs("fp-writer-assignment-note").value = writerAssignment.note;
  renderRequestedChecksEditor(pack);
  renderFieldPackMediaHintEditor(pack);
  autosizeFieldPackTextareas();
  renderFieldProgressControl();
}

function readFieldPackFormState() {
  const root = qs("fp-media-hints-editor");
  const renderedContentAssetIds = root
    ? Array.from(root.querySelectorAll(".media-hint-row"))
        .map((row) => Number(row.dataset.contentAssetId || 0) || 0)
        .filter(Boolean)
    : [];
  const selectedMediaHints = root
    ? Array.from(root.querySelectorAll(".media-hint-row"))
        .map((row) => {
          const checked = row.querySelector(".fp-media-hint-selected")?.checked === true;
          if (!checked) return null;
          const contentAssetId = Number(row.dataset.contentAssetId || 0) || null;
          return {
            content_asset_id: contentAssetId,
            url: normalizeMediaHintPayloadUrl(row.dataset.publicUrl, contentAssetId),
            kind: String(row.querySelector(".fp-media-hint-kind")?.value || "reference").trim() || "reference",
            caption: String(row.querySelector(".fp-media-hint-caption")?.value || "").trim() || null,
            selected: true,
          };
        })
        .filter(Boolean)
    : [];

  const mustCaptureItems = getMustCaptureEditorRows();
  return {
    id: Number(qs("fp-id")?.value || 0) || 0,
    status: String(qs("fp-status")?.value || "draft").trim() || "draft",
    writer_ready: Boolean(qs("fp-writer-ready")?.checked),
    ai_summary: String(qs("fp-ai-summary")?.value || "").trim(),
    ai_highlights: parseLineList(qs("fp-ai-highlights")?.value || ""),
    ai_unknowns: parseLineList(qs("fp-ai-unknowns")?.value || ""),
    editor_summary: String(qs("fp-editor-summary")?.value || "").trim(),
    verified_facts: parseLineList(qs("fp-verified-facts")?.value || ""),
    uncertain_facts: parseLineList(qs("fp-uncertain-facts")?.value || ""),
    story_angle: String(qs("fp-story-angle")?.value || "").trim(),
    field_notes: String(qs("fp-field-notes")?.value || "").trim(),
    must_verify_facts: parseLineList(qs("fp-must-verify-facts")?.value || ""),
    must_capture_items: mustCaptureItems,
    must_capture_shots: mustCaptureItems.map((row) => String(row.item_text || "").trim()).filter(Boolean),
    must_ask_questions: parseLineList(qs("fp-must-ask-questions")?.value || ""),
    social_hook: String(qs("fp-social-hook")?.value || "").trim(),
    social_shot_emphasis: parseLineList(qs("fp-social-shot-emphasis")?.value || ""),
    social_on_camera_points: parseLineList(qs("fp-social-on-camera-points")?.value || ""),
    social_caption_angle: String(qs("fp-social-caption-angle")?.value || "").trim(),
    requested_checks_json: state.fieldPack?.requested_checks_json && typeof state.fieldPack.requested_checks_json === "object"
      ? state.fieldPack.requested_checks_json
      : { version: 1, groups: [] },
    references_text: String(qs("fp-references")?.value || "").trim(),
    writer_references_text: String(qs("fp-writer-references")?.value || "").trim(),
    external_media_hints_text: String(qs("fp-external-media-hints")?.value || "").trim(),
    selected_media_hints: selectedMediaHints,
    rendered_content_asset_ids: renderedContentAssetIds,
    field_assignment: {
      linked_assignment_id: Number(qs("fp-field-assignment-id")?.value || 0) || 0,
      assigned_name: String(qs("fp-field-assigned-name")?.value || "").trim(),
      assigned_role: String(qs("fp-field-assigned-role")?.value || "").trim(),
      due_at: String(qs("fp-field-due-at")?.value || "").trim(),
      note: String(qs("fp-field-assignment-note")?.value || "").trim(),
    },
    writer_assignment: {
      linked_assignment_id: Number(qs("fp-writer-assignment-id")?.value || 0) || 0,
      assigned_name: String(qs("fp-writer-assigned-name")?.value || "").trim(),
      assigned_role: String(qs("fp-writer-assigned-role")?.value || "").trim(),
      due_at: String(qs("fp-writer-due-at")?.value || "").trim(),
      note: String(qs("fp-writer-assignment-note")?.value || "").trim(),
    },
  };
}

function buildFieldPackTopLevelPayload(pack) {
  return {
    id: pack.id || null,
    status: pack.status,
    writer_ready: pack.writer_ready,
    ai_summary: pack.ai_summary,
    ai_highlights: pack.ai_highlights,
    ai_unknowns: pack.ai_unknowns,
    editor_summary: pack.editor_summary,
    verified_facts: pack.verified_facts,
    uncertain_facts: pack.uncertain_facts,
    story_angle: pack.story_angle,
    field_notes: pack.field_notes,
    social_hook: pack.social_hook,
    social_shot_emphasis: pack.social_shot_emphasis,
    social_on_camera_points: pack.social_on_camera_points,
    social_caption_angle: pack.social_caption_angle,
    requested_checks_json: pack.requested_checks_json,
  };
}

function buildFieldPackChecklistPayload(pack, existing = state.fieldPack || {}) {
  const captureRows = (Array.isArray(pack.must_capture_items) ? pack.must_capture_items : []).map((row, index) => ({
    checklist_type: "must_capture",
    item_text: String(row?.item_text || "").trim(),
    capture_type: normalizeCaptureType(row?.capture_type, "photo"),
    item_order: index,
    status: String(row?.status || "todo").trim() || "todo",
    note: row?.note == null ? null : String(row.note || "").trim() || null,
  })).filter((row) => row.item_text);

  return [
    ...preserveChecklistRows(existing.checklists, "must_verify_fact", pack.must_verify_facts),
    ...captureRows,
    ...preserveChecklistRows(existing.checklists, "must_ask_question", pack.must_ask_questions),
  ];
}

function buildFieldPackReferencePayload(pack) {
  const generalReferences = parseFieldPackReferencesFromText(pack.references_text, "general");
  const writerReferences = parseFieldPackReferencesFromText(pack.writer_references_text, "writer");
  return [...generalReferences, ...writerReferences];
}

function buildFieldPackMediaHintPayload(pack, existing = state.fieldPack || {}) {
  const externalMediaHints = parseExternalMediaHintLines(pack.external_media_hints_text);
  const allowedContentAssetIds = getDraftSelectedImageAssets().map((row) => Number(row.id || 0)).filter(Boolean);
  return preserveMediaHints(
    existing.media_hints,
    pack.selected_media_hints,
    externalMediaHints,
    pack.rendered_content_asset_ids,
    allowedContentAssetIds
  );
}

function buildFieldPackAssignmentPayload(pack, existing = state.fieldPack || {}) {
  return [
    preserveAssignmentRow(existing.assignments, "field", pack.field_assignment),
    preserveAssignmentRow(existing.assignments, "writer", pack.writer_assignment),
  ].filter(Boolean);
}

function buildFieldPackApiPayload() {
  const pack = readFieldPackFormState();
  const existing = state.fieldPack || {};
  return {
    ...buildFieldPackTopLevelPayload({
      ...pack,
      requested_checks_json: existing.requested_checks_json && typeof existing.requested_checks_json === "object"
        ? existing.requested_checks_json
        : pack.requested_checks_json,
    }),
    field_pack_checklists: buildFieldPackChecklistPayload(pack, existing),
    field_pack_references: buildFieldPackReferencePayload(pack),
    field_pack_media_hints: buildFieldPackMediaHintPayload(pack, existing),
    field_pack_assignments: buildFieldPackAssignmentPayload(pack, existing),
  };
}

function buildEditorWorkPayload(workflowAction = null) {
  const itemPayload = buildPayload();
  if (!itemPayload.title || !itemPayload.description_raw) {
    throw new Error("Title and description are required before saving.");
  }
  if (workflowAction) itemPayload.workflow_action = workflowAction;
  return {
    item: itemPayload,
    field_pack: buildFieldPackApiPayload(),
  };
}

async function loadCurrentFieldPack() {
  if (isCleanMode) return null;
  const res = await api(`/api/items/${state.itemId}/field-pack/current`);
  state.fieldPack = res?.field_pack || null;
  fillFieldPackForm(state.fieldPack);
  return state.fieldPack;
}

async function loadItemAssignmentsForStep4() {
  if (isCleanMode || !state.itemId) {
    state.itemAssignments = [];
    state.itemAssignmentsLoadFailed = false;
    return [];
  }
  try {
    const res = await api(`/api/items/${state.itemId}/assignments`);
    state.itemAssignments = Array.isArray(res?.assignments) ? res.assignments : [];
    state.itemAssignmentsLoadFailed = false;
  } catch {
    state.itemAssignments = [];
    state.itemAssignmentsLoadFailed = true;
  }
  return state.itemAssignments;
}

async function saveCurrentFieldPack() {
  if (isCleanMode) return null;
  const payload = buildFieldPackApiPayload();
  const fieldPackId = Number(qs("fp-id")?.value || 0) || 0;
  const result = fieldPackId
    ? await api(`/api/field-packs/${fieldPackId}`, { method: "PUT", body: JSON.stringify(payload) })
    : await api(`/api/items/${state.itemId}/field-packs`, { method: "POST", body: JSON.stringify(payload) });
  state.fieldPack = result?.field_pack || null;
  fillFieldPackForm(state.fieldPack);
  return state.fieldPack;
}

async function returnCurrentFieldPackToClean(comment) {
  if (isCleanMode) return null;
  const note = String(comment || "").trim();
  if (!note) throw new Error("กรุณากรอกเหตุผลก่อนส่งกลับไป Clean");
  return api(`/api/items/${state.itemId}/field-pack/return-to-clean`, {
    method: "POST",
    body: JSON.stringify({ comment: note }),
  });
}

function isFieldPackReadyForAssignment(status) {
  const value = String(status || "").trim().toLowerCase();
  return value === "ready_for_field" || value === LEGACY_READY_FOR_HANDOFF_STATUS;
}

function buildPackagingRequirements(data, fieldPack) {
  const requirements = [];
  const statusValue = String(fieldPack.status || "draft").trim();
  const selectedImageCount = getDraftSelectedImageAssets().length;
  const summaryText = fieldPack.editor_summary || fieldPack.ai_summary || "";
  const sourceSummaryText = String(data.sourceSummaryText || "").trim();

  function addRequirement(id, label, message, severity = "hard") {
    requirements.push({ id, label, message, severity });
  }

  if (!isFieldPackReadyForAssignment(statusValue)) {
    addRequirement(
      "fp-status",
      "สถานะการส่งต่อ",
      statusValue === "on_hold"
        ? "ฟิลด์แพ็กถูกพักไว้ กรุณาปลดพักก่อน"
        : "ต้องเปลี่ยนสถานะเป็น \"พร้อมส่ง handoff\" ก่อน"
    );
  }
  if (!summaryText && data.descriptionLength < 180) {
    addRequirement("fp-editor-summary", "สรุปบรรณาธิการ", "ควรเขียนสรุปหลักจาก brief ให้ชัดเจน");
  }
  if (selectedImageCount < 1) {
    addRequirement(
      "fp-media-hints-editor",
      "รูปประกอบที่เลือก",
      "ควรมีอย่างน้อย 1 รูปที่เลือกไว้เพื่อใช้งานใน AI หรือ handoff",
      "soft"
    );
  }
  if (!fieldPack.must_verify_facts.length) {
    addRequirement("fp-must-verify-facts", "ข้อเท็จจริงที่ต้องตรวจ", "ควรมีรายการข้อเท็จจริงที่ต้องยืนยันก่อนเผยแพร่");
  }
  if (!fieldPack.must_capture_items.length) {
    addRequirement("fp-must-capture-shots", "Shot List", "ควรมีรายการช็อตภาพที่ต้องเก็บภาคสนาม");
  }
  if (!fieldPack.must_ask_questions.length) {
    addRequirement(
      "fp-must-ask-questions",
      "คำถามหน้างาน",
      "ควรเตรียมคำถามสำหรับเก็บข้อมูลเพิ่ม",
      "soft"
    );
  }
  if (!String(fieldPack.story_angle || data.angle || "").trim()) {
    addRequirement("fp-story-angle", "มุมเรื่อง", "ควรกำหนดมุมเล่าเรื่องให้ชัดเจนขึ้น", "soft");
  }
  if (!sourceSummaryText || sourceSummaryText === "ยังไม่พบแหล่งอ้างอิงที่สรุปได้") {
    addRequirement(
      "fp-references",
      "แหล่งอ้างอิง",
      "ควรมีแหล่งอ้างอิงที่ชัดเจนอย่างน้อย 1 แหล่งที่ตรวจสอบได้",
      "soft"
    );
  }
  if (!String(fieldPack.field_notes || "").trim()) {
    addRequirement("fp-field-notes", "บันทึกภาคสนาม", "ควรเพิ่มบันทึกที่ช่วยให้ editor ติดตามประเด็นได้ตรงจุด", "soft");
  }

  return requirements;
}

function findRequirementContainer(fieldId) {
  const field = qs(fieldId);
  if (!field) return null;
  return field.closest(".full-span") || field.parentElement || null;
}

function findRequirementLabel(fieldId, container) {
  if (container) {
    const directLabel = container.querySelector(":scope > label");
    if (directLabel) return directLabel;
  }
  const field = qs(fieldId);
  return field?.previousElementSibling?.tagName === "LABEL" ? field.previousElementSibling : null;
}

function ensureRequiredPill(label) {
  if (!label) return;
  let pill = label.querySelector(".required-pill");
  if (pill) return pill;
  pill = document.createElement("span");
  pill.className = "required-pill";
  pill.textContent = "จำเป็น";
  label.appendChild(document.createTextNode(" "));
  label.appendChild(pill);
  return pill;
}

function removeRequiredPill(label) {
  if (!label) return;
  label.querySelector(".required-pill")?.remove();
}

function updatePackagingRequirementMarkers(requirements) {
  const requirementMap = new Map((Array.isArray(requirements) ? requirements : []).map((item) => [item.id, item]));
  [
    "fp-status",
    "fp-story-angle",
    "fp-editor-summary",
    "fp-media-hints-editor",
    "fp-must-verify-facts",
    "fp-must-capture-shots",
    "fp-must-ask-questions",
    "fp-references",
    "fp-field-notes",
  ].forEach((fieldId) => {
    const container = findRequirementContainer(fieldId);
    const label = findRequirementLabel(fieldId, container);
    if (!container || !label) return;

    const requirement = requirementMap.get(fieldId) || null;
    const isHardRequirement = Boolean(requirement) && String(requirement.severity || "hard") !== "soft";
    label.classList.toggle("required-label", isHardRequirement);
    if (isHardRequirement) {
      ensureRequiredPill(label);
    } else {
      removeRequiredPill(label);
    }
    container.classList.toggle("field-requirement-missing", isHardRequirement);
    container.classList.toggle("field-requirement-soft", Boolean(requirement) && !isHardRequirement);

    let note = container.querySelector(":scope > .field-requirement-note");
    if (!requirement) {
      if (note) note.remove();
      return;
    }
    if (!note) {
      note = document.createElement("div");
      note.className = "field-requirement-note";
      const help = container.querySelector(":scope > .field-help");
      if (help) {
        help.insertAdjacentElement("afterend", note);
      } else {
        container.appendChild(note);
      }
    }
    note.classList.toggle("soft", !isHardRequirement);
    note.textContent = requirement.message;
  });
}

function renderPackagingSectionWarnings(requirements) {
  const requirementMap = new Map((Array.isArray(requirements) ? requirements : []).map((item) => [item.id, item]));
  [
    "fp-status",
    "fp-editor-summary",
    "fp-must-verify-facts",
    "fp-must-capture-shots",
    "fp-must-ask-questions",
    "fp-story-angle",
    "fp-media-hints-editor",
    "fp-references",
    "fp-field-notes",
  ].forEach((fieldId) => {
    const container = findRequirementContainer(fieldId);
    const label = findRequirementLabel(fieldId, container);
    if (!container || !label) return;

    const requirement = requirementMap.get(fieldId) || null;
    let warning = container.querySelector(":scope > .section-warning");
    if (!requirement) {
      if (warning) warning.remove();
      return;
    }
    if (!warning) {
      warning = document.createElement("div");
      warning.className = "section-warning";
      label.insertAdjacentElement("afterend", warning);
    }
    const isSoft = String(requirement.severity || "hard") === "soft";
    warning.className = `section-warning${isSoft ? " soft" : ""}`;
    warning.innerHTML = `<strong>${escapeHtml(requirement.label)}</strong><span>${escapeHtml(requirement.message)}</span>`;
  });
}

function renderPackagingSummary() {
  const root = qs("packaging-summary");
  if (!root || isCleanMode) return;

  const data = buildDraftGuideData();
  const fieldPack = readFieldPackFormState();
  const formRequirements = buildPackagingRequirements(data, fieldPack);
  updatePackagingRequirementMarkers(formRequirements);
  renderPackagingSectionWarnings(formRequirements);

  const guardRequirements = [];
  const editGuard = getEditPermissionGuard();
  if (!editGuard.allowed) {
    guardRequirements.push({
      label: "สิทธิ์การแก้ไข",
      message: editGuard.reason,
      severity: "hard",
    });
  } else {
    const assignmentGuard = getEditorAssignmentGuard();
    if (!assignmentGuard.allowed) {
      guardRequirements.push({
        label: "เงื่อนไขการส่งต่อ",
        message: assignmentGuard.reason,
        severity: "hard",
      });
    }
  }
  const requirements = [...guardRequirements, ...formRequirements];
  const hardRequirements = requirements.filter((item) => String(item?.severity || "hard") !== "soft");
  const softRequirements = requirements.filter((item) => String(item?.severity || "hard") === "soft");

  const selectedImageCount = getDraftSelectedImageAssets().length;
  const statusText = hardRequirements.length
    ? "ยังไม่พร้อมส่ง handoff"
    : softRequirements.length
      ? "พร้อมส่ง handoff แต่มีจุดที่ควรเติม"
      : "พร้อมส่ง handoff แล้ว";
  const statusClass = hardRequirements.length ? "fail" : softRequirements.length ? "warn" : "ok";
  const tagSummary = data.tags.length ? data.tags.join(" | ") : "ยังไม่มีแท็ก";
  const fieldPackStatusLabels = {
    draft: "ร่าง",
    ready_for_field: "พร้อมส่ง handoff",
    field_in_progress: "กำลังทำภาคสนาม",
    field_done: "ภาคสนามเสร็จ",
    on_hold: "พักงาน",
  };
  const statusValue = String(fieldPack.status || "draft").trim();

  root.innerHTML = `
    <h4>สรุปความพร้อมก่อนส่งต่อ</h4>
    <div class="summary-row"><strong>ชื่อเรื่อง</strong><span>${escapeHtml(data.fallbackTitle)}</span></div>
    <div class="summary-row"><strong>มุมเรื่อง</strong><span>${escapeHtml(fieldPack.story_angle || data.angle)}</span></div>
    <div class="summary-row"><strong>กลุ่มเป้าหมาย</strong><span>${escapeHtml(data.audience)}</span></div>
    <div class="summary-row"><strong>แหล่งอ้างอิง</strong><span>${escapeHtml(data.sourceSummaryText || "ไม่มีข้อมูล")}</span></div>
    <div class="summary-row"><strong>สรุปเนื้อหา</strong><span>${escapeHtml(fieldPack.editor_summary || fieldPack.ai_summary || data.keyMessage)}</span></div>
    <div class="summary-row"><strong>แท็ก</strong><span>${escapeHtml(tagSummary)}</span></div>
    <div class="summary-row"><strong>รูปที่เลือก</strong><span>${escapeHtml(selectedImageCount > 0 ? `${selectedImageCount} รูป` : "ไม่มี")}</span></div>
    <div class="summary-row"><strong>สถานะฟิลด์แพ็ก</strong><span>${escapeHtml(fieldPackStatusLabels[statusValue] || statusValue || "ไม่มี")}</span></div>
    <div class="summary-row"><strong>ความพร้อม</strong><span class="${statusClass}">${escapeHtml(statusText)}</span></div>
    ${hardRequirements.length
      ? `<div class="readiness-alert"><h4>สิ่งที่ต้องแก้ก่อนส่ง handoff</h4><ul>${hardRequirements.map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.message)}</li>`).join("")}</ul></div>`
      : softRequirements.length
        ? `<div class="readiness-alert warn"><h4>พร้อมส่ง handoff แต่ยังมีข้อเสนอแนะ</h4><ul>${softRequirements.map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.message)}</li>`).join("")}</ul></div>`
        : '<div class="readiness-alert ready"><h4>พร้อมส่ง</h4><ul><li>ข้อมูลครบและสามารถส่งต่อขั้น handoff ได้แล้ว</li></ul></div>'}
    ${hardRequirements.length && softRequirements.length
      ? `<div class="readiness-alert warn"><h4>ข้อเสนอแนะเพิ่มเติม</h4><ul>${softRequirements.map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.message)}</li>`).join("")}</ul></div>`
      : ""}
  `;
}

function getStepFourLatestAssignment(fieldPack, assignments = state.itemAssignments || []) {
  const rows = Array.isArray(assignments) ? assignments : [];
  const linkedFieldAssignment = Array.isArray(fieldPack?.assignments)
    ? fieldPack.assignments.find((row) => String(row?.assignment_scope || "") === "field") || null
    : null;
  const linkedAssignmentId = Number(linkedFieldAssignment?.linked_assignment_id || fieldPack?.field_assignment?.linked_assignment_id || 0) || 0;
  if (linkedAssignmentId > 0) {
    const linked = rows.find((row) => Number(row?.id || 0) === linkedAssignmentId);
    if (linked) return linked;
  }
  return null;
}

function formatStepFourAssignmentState(stateValue) {
  const value = String(stateValue || "").trim().toLowerCase();
  if (value === "assigned") return "มอบหมายแล้ว";
  if (value === "in_progress") return "กำลังดำเนินการ";
  if (value === "submitted" || value === "resubmitted") return "ส่งงานแล้ว";
  if (value === "revision_requested") return "ขอแก้ไข";
  if (value === "accepted") return "อนุมัติแล้ว";
  if (value === "closed") return "ปิดงานแล้ว";
  return value || "-";
}

function renderStepFourNextPanel() {
  const root = qs("step4-next-panel");
  if (!root || isCleanMode) return;

  const fieldPack = readFieldPackFormState();
  const statusValue = String(fieldPack.status || "draft").trim().toLowerCase();
  const isReady = isFieldPackReadyForAssignment(statusValue);
  const loadFailed = Boolean(state.itemAssignmentsLoadFailed);
  const hasAnyAssignments = Array.isArray(state.itemAssignments) && state.itemAssignments.length > 0;
  const latestAssignment = getStepFourLatestAssignment(fieldPack);
  const fieldAssignment = fieldPack.field_assignment || {};
  const assignmentId = Number(latestAssignment?.id || fieldAssignment.linked_assignment_id || 0) || 0;
  const assignedName = String(latestAssignment?.assignee_display_name || "").trim()
    || String(fieldAssignment.assigned_name || "").trim()
    || String(latestAssignment?.assignee_email || "").trim()
    || (Number(latestAssignment?.assignee_user_id || 0) > 0 ? `user #${Number(latestAssignment.assignee_user_id)}` : "");
  const dueAt = String(latestAssignment?.due_at || fieldAssignment.due_at || "").trim() || "-";
  const assignmentState = latestAssignment ? formatStepFourAssignmentState(latestAssignment.state) : "ไม่มี";

  let summary = "ตรวจความพร้อมของ brief ก่อนส่งต่อ handoff";
  let details = [
    { label: "สถานะฟิลด์แพ็ก", value: getFieldProgressStatusLabel(statusValue) },
  ];
  let actionLabel = "";

  if (loadFailed) {
    summary = "โหลดข้อมูลงานมอบหมายไม่สำเร็จ กรุณาตรวจสอบและลองใหม่";
    details = [
      { label: "สถานะฟิลด์แพ็ก", value: getFieldProgressStatusLabel(statusValue) },
      { label: "สถานะระบบ", value: "ไม่สามารถโหลด assignment ได้" },
    ];
    actionLabel = isReady ? "เปิดหน้าส่งต่อ" : "";
  } else if (isReady && latestAssignment) {
    summary = "มีงานมอบหมายล่าสุดแล้ว สามารถติดตามสถานะต่อได้";
    details = [
      { label: "เลขงาน", value: `#${assignmentId}` },
      { label: "ผู้รับงาน", value: assignedName || "-" },
      { label: "กำหนดส่ง", value: dueAt },
      { label: "สถานะงาน", value: assignmentState },
    ];
    actionLabel = "เปิดหน้าส่งต่อ";
  } else if (isReady && hasAnyAssignments) {
    summary = "สถานะพร้อมส่งแล้ว แต่ยังไม่พบ assignment ที่ผูกกับฟิลด์แพ็กนี้";
    details = [
      { label: "สถานะฟิลด์แพ็ก", value: "พร้อมส่ง handoff" },
      { label: "สถานะระบบ", value: "มี assignment แต่ยังไม่เชื่อมกับรายการนี้" },
    ];
    actionLabel = "เปิดหน้าส่งต่อ";
  } else if (isReady) {
    summary = "พร้อมส่ง handoff แล้วและสามารถเริ่มงานขั้นถัดไปได้";
    details = [
      { label: "สถานะฟิลด์แพ็ก", value: "พร้อมส่ง handoff" },
      { label: "สถานะงาน", value: "ยังไม่มี assignment" },
    ];
    actionLabel = "เปิดหน้าส่งต่อ";
  }

  root.innerHTML = `
    <strong>ขั้นถัดไป</strong>
    <div class="field-help">${escapeHtml(summary)}</div>
    <div class="step4-next-summary">
      ${details.map((item) => `<div class="summary-row"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.value)}</span></div>`).join("")}
    </div>
    ${actionLabel ? `<div class="step4-next-actions"><button type="button" class="primary" id="btn-step4-next-panel">${escapeHtml(actionLabel)}</button></div>` : ""}
  `;

  root.querySelector("#btn-step4-next-panel")?.addEventListener("click", () => {
    qs("btn-next-export")?.click();
  });
}

function renderGuideCards(rootId, cards) {
  const root = qs(rootId);
  if (!root) return;
  const list = Array.isArray(cards) ? cards : [];
  const sections = list
    .map((card) => {
      const rowsHtml = Array.isArray(card.rows)
        ? card.rows.map((row) => {
          const labelText = escapeHtml(row?.label || "-");
          if (row?.kind === "reference_summary") {
            return `<p class="brief-block-text"><strong>${labelText}:</strong> ${buildReferenceLabelListHtml(row?.referenceItems, row?.emptyText || "ไม่มีข้อมูล")}</p>`;
          }
          return `<p class="brief-block-text"><strong>${labelText}:</strong> ${escapeHtml(row?.value || "-")}</p>`;
        }).join("")
        : "";
      const listHtml = card.listTitle
        ? `<h4>${escapeHtml(card.listTitle)}</h4>${buildListHtml(card.items)}`
        : buildListHtml(card.items);
      return `
        <h3>${escapeHtml(card.title || "-")}</h3>
        ${rowsHtml}
        ${listHtml}
      `;
    })
    .join("");
  root.innerHTML = `<article class="article-brief-doc">${sections}</article>`;
}

function buildReferenceLabelListHtml(items, emptyText = "ไม่มีข้อมูล") {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return `<span>${escapeHtml(emptyText)}</span>`;
  return rows.map((item) => {
    const label = String(item?.label || "").trim();
    const url = sanitizeUrl(item?.url || "");
    if (url) {
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label || "ลิงก์อ้างอิง")}</a>`;
    }
    return `<span>${escapeHtml(label || "-")}</span>`;
  }).join(", ");
}

function buildListHtml(items) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<ul class="brief-list">${items
    .map((item) => `<li>${escapeHtml(item || "-")}</li>`)
    .join("")}</ul>`;
}

function buildFieldQuestions(data, signals) {
  const questions = [
    `ผู้ใช้มักเลือก ${data.fallbackTitle} เพราะอะไร และคาดหวังอะไรจากที่นี่`,
    `จุดไหนของ ${data.fallbackTitle} ที่ควรถ่ายหรือย้ำในเนื้อหา`,
    `มีข้อมูลใดของ ${data.fallbackTitle} ที่ยังต้องยืนยันก่อนเผยแพร่`,
  ];

  if (data.category === "cafes" || data.category === "restaurants") {
    questions.push(`ช่วงเวลาไหนเหมาะที่สุดในการไป ${data.fallbackTitle}`);
    questions.push(`เมนูหรือมุมเด่นของ ${data.fallbackTitle} คืออะไร`);
  } else if (data.category === "attractions" || data.category === "activities") {
    questions.push(`มีข้อควรระวังอะไรเมื่อไป ${data.fallbackTitle}`);
    questions.push(`การเดินทางไป ${data.fallbackTitle} ควรรู้อะไรล่วงหน้า`);
  } else if (data.category === "hotels") {
    questions.push(`สิ่งอำนวยความสะดวกของ ${data.fallbackTitle} มีอะไรที่ควรเช็กก่อนจอง`);
  } else if (data.category === "transport") {
    questions.push(`จุดขึ้นลงหรือเส้นทางของ ${data.fallbackTitle} มีเงื่อนไขพิเศษหรือไม่`);
  }

  for (const signal of signals.slice(0, 2)) {
    questions.push(`มีหลักฐานยืนยันประเด็น "${signal.shortLabel}" ของ ${data.fallbackTitle} เพียงพอแล้วหรือยัง`);
  }

  return Array.from(new Set(questions.map((item) => normalizeWhitespace(item)).filter(Boolean)));
}

function buildAiSummaryCardsFromData(data) {
  const signals = Array.isArray(data.primarySignals) ? data.primarySignals : [];
  const leadSignals = signals.slice(0, 3);
  const unknowns = [];
  if (!data.sourceUrl) unknowns.push("ยังไม่มี URL แหล่งข้อมูลหลักใน brief");
  if (!String(qs("e-lat")?.value || "").trim() || !String(qs("e-lng")?.value || "").trim()) {
    unknowns.push(`ยังไม่มีพิกัดที่ครบถ้วนสำหรับ ${data.fallbackTitle}`);
  }
  if (data.assetCount < 1) unknowns.push(`ยังไม่มีรูปอ้างอิงสำหรับ ${data.fallbackTitle}`);
  if (data.descriptionLength < 180) {
    unknowns.push(`คำอธิบายของ ${data.fallbackTitle} ยังสั้น ควรเพิ่มรายละเอียด`);
  }
  unknowns.push(...leadSignals.slice(0, 2).map((signal) => signal.verification));

  return [
    {
      title: "มุมสรุป AI",
      rows: [
        { label: "สถานที่/หัวข้อ", value: data.fallbackTitle },
        { label: "มุมเรื่อง", value: data.angle },
        { label: "กลุ่มเป้าหมาย", value: data.audience },
        { label: "Hook หลัก", value: data.hook },
      ],
      listTitle: "ประเด็นที่ AI ควรเน้น",
      items: leadSignals.map((signal) => signal.summary),
    },
    {
      title: "ช่องว่างข้อมูลที่ต้องตรวจ",
      rows: [
        {
          label: "แหล่งอ้างอิง",
          kind: "reference_summary",
          referenceItems: data.sourceSummaryLinks || [],
          emptyText: "ไม่มีข้อมูล",
        },
        { label: "signal focus", value: data.signalFocus || data.angle },
        { label: "เป้าหมายตรวจสอบ", value: "ยืนยันข้อเท็จจริงให้ครบก่อนส่งต่อทีมภาคสนาม" },
      ],
      listTitle: "รายการที่ควรตรวจเพิ่ม",
      items: Array.from(new Set(unknowns.filter(Boolean))),
    },
  ];
}

function buildAiSummaryCards() {
  const data = buildDraftGuideData();
  const fieldPack = readFieldPackFormState();
  const fallbackCards = buildAiSummaryCardsFromData(data);
  return [
    {
      title: "มุมสรุป AI",
      rows: [
        { label: "สถานที่/หัวข้อ", value: data.fallbackTitle },
        { label: "มุมเรื่อง", value: fieldPack.ai_summary || data.angle },
        { label: "กลุ่มเป้าหมาย", value: data.audience },
        { label: "Hook หลัก", value: fieldPack.social_hook || data.hook },
      ],
      listTitle: "ประเด็นที่ AI ควรเน้น",
      items: fieldPack.ai_highlights.length ? fieldPack.ai_highlights : (fallbackCards[0]?.items || []),
    },
    {
      title: "ช่องว่างข้อมูลที่ต้องตรวจ",
      rows: [
        {
          label: "แหล่งอ้างอิง",
          kind: "reference_summary",
          referenceItems: data.sourceSummaryLinks || [],
          emptyText: "ไม่มีข้อมูล",
        },
        { label: "signal focus", value: data.signalFocus || data.angle },
        { label: "เป้าหมายตรวจสอบ", value: "ยืนยันข้อเท็จจริงให้ครบก่อนส่งต่อทีมภาคสนาม" },
      ],
      listTitle: "รายการที่ควรตรวจเพิ่ม",
      items: fieldPack.ai_unknowns.length ? fieldPack.ai_unknowns : (fallbackCards[1]?.items || []),
    },
  ];
}

function buildFactCheckCardsFromData(data) {
  const signals = Array.isArray(data.primarySignals) ? data.primarySignals : [];
  const lat = String(qs("e-lat")?.value || "").trim();
  const lng = String(qs("e-lng")?.value || "").trim();
  const baselineFacts = [
    data.title ? `ชื่อเรื่อง: ${data.title}` : "",
    data.category ? `หมวด: ${data.categoryLabel}` : "",
    data.sourceSummaryText && data.sourceSummaryText !== "ยังไม่พบแหล่งอ้างอิงที่สรุปได้" ? `แหล่งอ้างอิง: ${data.sourceSummaryText}` : "",
    lat && lng ? `พิกัด: ${lat}, ${lng}` : "",
    data.tags.length ? `แท็ก: ${data.tags.join(" | ")}` : "",
  ].filter(Boolean);
  const mustConfirm = [
    data.sourceSummaryText && data.sourceSummaryText !== "ยังไม่พบแหล่งอ้างอิงที่สรุปได้"
      ? `ตรวจยืนยันข้อมูลจาก ${data.sourceSummaryText} ก่อนเผยแพร่`
      : "ยังไม่มีแหล่งอ้างอิงที่ชัดเจนสำหรับการยืนยันข้อมูล",
    ...signals.slice(0, 3).map((signal) => signal.verification),
    !lat || !lng ? `ควรยืนยันพิกัดของ ${data.fallbackTitle}` : "",
    data.category === "attractions" || data.category === "activities" ? `ควรตรวจสอบช่วงเวลาที่เหมาะสมของ ${data.fallbackTitle}` : "",
    (data.category === "cafes" || data.category === "restaurants") ? `ควรยืนยันราคา/เมนูหลักของ ${data.fallbackTitle}` : "",
  ].filter(Boolean);

  return [
    {
      title: "ข้อมูลตั้งต้นที่ยืนยันได้",
      rows: [
        { label: "หัวข้อ", value: data.fallbackTitle },
        { label: "หมวด", value: data.categoryLabel },
        {
          label: "แหล่งอ้างอิง",
          kind: "reference_summary",
          referenceItems: data.sourceSummaryLinks || [],
          emptyText: "ไม่มีข้อมูล",
        },
      ],
      listTitle: "รายการข้อมูลที่มี",
      items: baselineFacts,
    },
    {
      title: "ข้อมูลที่ต้องตรวจเพิ่ม",
      rows: [
        { label: "เป้าหมาย", value: `ยืนยัน fact สำคัญก่อนเผยแพร่ draft ของ ${data.fallbackTitle}` },
        { label: "หมายเหตุ", value: "ข้อมูลในรายการนี้ควรถูกยืนยันจากแหล่งที่เชื่อถือได้" },
      ],
      listTitle: "รายการต้องตรวจ",
      items: Array.from(new Set(mustConfirm)),
    },
  ];
}

function buildFactCheckCards() {
  const data = buildDraftGuideData();
  const fieldPack = readFieldPackFormState();
  const fallbackCards = buildFactCheckCardsFromData(data);
  return [
    {
      title: "ข้อมูลตั้งต้นที่ยืนยันได้",
      rows: fallbackCards[0]?.rows || [],
      listTitle: "รายการข้อมูลที่มี",
      items: fieldPack.verified_facts.length ? fieldPack.verified_facts : (fallbackCards[0]?.items || []),
    },
    {
      title: "ข้อมูลที่ต้องตรวจเพิ่ม",
      rows: fallbackCards[1]?.rows || [],
      listTitle: "รายการต้องตรวจ",
      items: fieldPack.uncertain_facts.length ? fieldPack.uncertain_facts : (fallbackCards[1]?.items || []),
    },
  ];
}

function buildFieldPackCardsFromData(data) {
  const signals = Array.isArray(data.primarySignals) ? data.primarySignals : [];
  const mustConfirm = [
    data.sourceSummaryText && data.sourceSummaryText !== "ยังไม่พบแหล่งอ้างอิงที่สรุปได้"
      ? `ตรวจสอบความถูกต้องจาก ${data.sourceSummaryText} ก่อนส่งต่อ`
      : "ยังไม่มีแหล่งอ้างอิงที่ยืนยันข้อมูลได้ชัดเจน",
    ...signals.slice(0, 3).map((signal) => signal.verification),
  ];
  const mustShoot = signals.slice(0, 3).map((signal) => signal.fieldTask);
  const mustAsk = buildFieldQuestions(data, signals);
  const socialTalkingPoints = [
    data.hook,
    ...signals.slice(0, 2).map((signal) => signal.headline),
    data.cta,
  ].filter(Boolean);

  return [
    {
      title: "สิ่งที่ต้องยืนยันเพิ่มเติม",
      rows: [
        { label: "เป้าหมาย", value: `ยืนยัน fact สำคัญของ ${data.fallbackTitle}` },
        { label: "มุมเรื่อง", value: data.angle },
      ],
      listTitle: "รายการยืนยันหน้างาน",
      items: Array.from(new Set(mustConfirm)),
    },
    {
      title: "ช็อตที่ควรถ่าย",
      rows: [
        { label: "Hook", value: data.hook },
        { label: "signal focus", value: data.signalFocus || data.angle },
      ],
      listTitle: "Shot List",
      items: Array.from(new Set(mustShoot)),
    },
    {
      title: "คำถามที่ควรถามหน้างาน",
      rows: [
        { label: "กลุ่มคำถาม", value: "เวลา / ราคา / ข้อจำกัด / ความเหมาะสม" },
        { label: "เป้าหมาย", value: "เติมช่องว่างของ fact ที่ยังยืนยันไม่ครบ" },
      ],
      listTitle: "คำถามแนะนำ",
      items: mustAsk,
    },
    {
      title: "แนวทาง social",
      rows: [
        { label: "มุมสื่อสาร", value: data.angle },
        { label: "แนว Caption", value: buildPlatformDirection("facebook", data, signals.slice(0, 3)) },
      ],
      listTitle: "ประเด็นพูดหน้ากล้อง",
      items: socialTalkingPoints,
    },
  ];
}

function buildFieldPackCards() {
  const data = buildDraftGuideData();
  const fieldPack = readFieldPackFormState();
  const fallbackCards = buildFieldPackCardsFromData(data);
  return [
    {
      title: "สิ่งที่ต้องยืนยันเพิ่มเติม",
      rows: [
        { label: "เป้าหมาย", value: `ยืนยัน fact สำคัญของ ${data.fallbackTitle}` },
        { label: "มุมเรื่อง", value: fieldPack.story_angle || data.angle },
      ],
      listTitle: "รายการยืนยันหน้างาน",
      items: fieldPack.must_verify_facts.length ? fieldPack.must_verify_facts : (fallbackCards[0]?.items || []),
    },
    {
      title: "ช็อตที่ควรถ่าย",
      rows: [
        { label: "Hook", value: fieldPack.social_hook || data.hook },
        { label: "signal focus", value: data.signalFocus || data.angle },
      ],
      listTitle: "Shot List",
      items: fieldPack.must_capture_items.length
        ? formatMustCaptureDisplayItems(fieldPack.must_capture_items)
        : (fallbackCards[1]?.items || []),
    },
    {
      title: "คำถามที่ควรถามหน้างาน",
      rows: fallbackCards[2]?.rows || [],
      listTitle: "คำถามแนะนำ",
      items: fieldPack.must_ask_questions.length ? fieldPack.must_ask_questions : (fallbackCards[2]?.items || []),
    },
    {
      title: "แนวทาง social",
      rows: [
        { label: "มุมสื่อสาร", value: fieldPack.story_angle || data.angle },
        { label: "แนว Caption", value: fieldPack.social_caption_angle || buildPlatformDirection("facebook", data, data.primarySignals.slice(0, 3)) },
      ],
      listTitle: "ประเด็นพูดหน้ากล้อง",
      items: fieldPack.social_on_camera_points.length ? fieldPack.social_on_camera_points : (fallbackCards[3]?.items || []),
    },
  ];
}

function toReviewList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => String(row || "").trim()).filter(Boolean);
}

function parseFieldPackContractFromWriterNotes(writerNotes) {
  const raw = String(writerNotes || "").trim();
  if (!raw) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const topLevelVersion = String(parsed.contract_version || "").trim();
  const provenanceVersion = String(parsed?.provenance?.contract_version || "").trim();
  const resolvedVersion = topLevelVersion || provenanceVersion;
  if (!resolvedVersion) return null;
  return {
    ...parsed,
    contract_version: resolvedVersion,
  };
}

function buildContractFactRows(coreFacts = {}) {
  if (!coreFacts || typeof coreFacts !== "object" || Array.isArray(coreFacts)) return [];
  const rows = [];
  for (const [key, value] of Object.entries(coreFacts)) {
    if (value == null) continue;
    const text = Array.isArray(value) ? value.join(", ") : String(value).trim();
    if (!text) continue;
    rows.push({ key, value: text });
  }
  return rows;
}

function parseTaxonomyContract(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return null;
  return String(contract.taxonomy_version || "").trim() === "page_curation_taxonomy_v1" ? contract : null;
}

function taxonomyFieldLabel(key) {
  return String(key || "")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function taxonomyBadge(label, tone = "neutral") {
  const className = tone === "warning"
    ? "workflow-badge workflow-badge-generated"
    : tone === "danger"
      ? "workflow-badge workflow-badge-sent"
      : "workflow-badge workflow-badge-raw";
  return `<span class="${className}">${escapeHtml(label)}</span>`;
}

function isLikelyUrl(value) {
  const text = String(value || "").trim().toLowerCase();
  return text.startsWith("http://")
    || text.startsWith("https://")
    || text.startsWith("/api/")
    || text.startsWith("/uploads/")
    || text.startsWith("/collector/");
}

function normalizeTaxonomyItems(items = []) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(items) ? items : []) {
    const text = String(raw || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function renderPreviewText(text, previewLimit = 200) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  if (isLikelyUrl(normalized)) {
    return `<a href="${escapeHtml(normalized)}" target="_blank" rel="noreferrer">open link</a>`;
  }
  if (normalized.length <= previewLimit) return escapeHtml(normalized);
  const preview = `${normalized.slice(0, previewLimit).trimEnd()}...`;
  return `${escapeHtml(preview)}<details><summary>show more</summary><div>${escapeHtml(normalized)}</div></details>`;
}

function taxonomyListValue(items = [], options = {}) {
  const tone = options.tone || "neutral";
  const list = normalizeTaxonomyItems(items);
  if (!list.length) return "";
  const visibleItems = list.slice(0, 5);
  const hiddenItems = list.slice(5);
  const visibleHtml = visibleItems.map((item) => `<li>${tone === "normal" ? renderPreviewText(item) : taxonomyBadge(item, tone)}</li>`).join("");
  const hiddenHtml = hiddenItems.length
    ? `<details><summary>show ${hiddenItems.length} more</summary><ul>${hiddenItems.map((item) => `<li>${tone === "normal" ? renderPreviewText(item) : taxonomyBadge(item, tone)}</li>`).join("")}</ul></details>`
    : "";
  return `<ul>${visibleHtml}</ul>${hiddenHtml}`;
}

function taxonomyScalarValue(value, options = {}) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (text === "unknown") return taxonomyBadge("unknown", "neutral");
  if (options.warning) return taxonomyBadge(text, "warning");
  return escapeHtml(text);
}

function renderTaxonomyStatusBadges(field, needsVerificationSet, publishBlockerSet) {
  const badges = [];
  if (publishBlockerSet.has(field)) badges.push(taxonomyBadge("publish blocker", "danger"));
  if (needsVerificationSet.has(field)) badges.push(taxonomyBadge("needs verification", "warning"));
  return badges.join(" ");
}

function renderTaxonomyFieldHtml(field, value, needsVerificationSet, publishBlockerSet) {
  const isPublishBlocker = publishBlockerSet.has(field);
  const isNeedsVerification = needsVerificationSet.has(field);
  const statusBadges = renderTaxonomyStatusBadges(field, needsVerificationSet, publishBlockerSet);

  if (Array.isArray(value)) {
    const normalized = normalizeTaxonomyItems(value);
    if (!normalized.length && !isPublishBlocker && !isNeedsVerification) return "";
    if (!normalized.length) return statusBadges;
    const listHtml = taxonomyListValue(normalized, { tone: "normal" });
    return statusBadges ? `<div>${listHtml}</div><div>${statusBadges}</div>` : listHtml;
  }

  const scalar = String(value == null ? "" : value).trim();
  if (!scalar && !isPublishBlocker && !isNeedsVerification) return "";
  if (!scalar) return statusBadges;
  if (scalar === "unknown" && !isPublishBlocker && !isNeedsVerification) return "";

  const valueHtml = scalar === "unknown"
    ? taxonomyScalarValue(scalar, { warning: false })
    : renderPreviewText(scalar);
  return statusBadges ? `<div>${valueHtml}</div><div>${statusBadges}</div>` : valueHtml;
}

function buildTaxonomySections(contract) {
  const verification = contract.verification && typeof contract.verification === "object" ? contract.verification : {};
  const needsVerificationSet = new Set(toReviewList(verification.needs_verification));
  const publishBlockers = toReviewList(verification.publish_blockers);
  const publishBlockerSet = new Set(publishBlockers);
  const sectionConfigs = [
    {
      title: "Universal Curation",
      key: "universal_curation_profile",
      fields: ["highlights", "good_to_know", "why_visit", "recommended_for", "best_for", "nearby", "local_notes"],
    },
    {
      title: "Practical Profile",
      key: "practical_profile",
      fields: ["price_range", "parking", "pet_friendly", "family_friendly", "accessibility", "opening_hours_note", "reservation_needed"],
    },
    {
      title: "Place Profile",
      key: "place_profile",
      fields: ["view_type", "atmosphere", "photo_spots", "visit_duration", "best_time_to_visit"],
    },
    {
      title: "Restaurant Profile",
      key: "restaurant_profile",
      fields: ["restaurant_features", "signature_menu", "cuisine_type", "price_signals", "service_style", "seating_vibe"],
    },
    {
      title: "Hotel Profile",
      key: "hotel_profile",
      fields: ["hotel_amenities", "room_type_hints", "checkin_checkout", "booking_channels", "nearby_landmarks", "stay_best_for"],
    },
    {
      title: "Event Profile",
      key: "event_profile",
      fields: ["event_date_hints", "schedule_hints", "ticket_hints", "venue_notes", "event_best_for"],
    },
  ];

  const sections = [];
  for (const config of sectionConfigs) {
    const source = contract[config.key] && typeof contract[config.key] === "object" ? contract[config.key] : {};
    const rows = [];
    for (const field of config.fields) {
      const html = renderTaxonomyFieldHtml(field, source[field], needsVerificationSet, publishBlockerSet);
      if (!html) continue;
      rows.push({
        label: taxonomyFieldLabel(field),
        html,
      });
    }
    if (rows.length) sections.push({ title: config.title, rows });
  }

  const verificationRows = [];
  const verifiedFacts = normalizeTaxonomyItems(verification.verified_facts);
  if (verifiedFacts.length) {
    verificationRows.push({ label: "Verified Facts", html: taxonomyListValue(verifiedFacts, { tone: "normal" }) });
  }
  const needsVerification = normalizeTaxonomyItems(verification.needs_verification);
  if (needsVerification.length) {
    verificationRows.push({ label: "Needs Verification", html: taxonomyListValue(needsVerification, { tone: "warning" }) });
  }
  if (publishBlockers.length) {
    verificationRows.push({ label: "Publish Blockers", html: taxonomyListValue(publishBlockers, { tone: "danger" }) });
  }
  if (verificationRows.length) sections.push({ title: "Verification", rows: verificationRows });

  return sections;
}

function renderStepFourGuides() {
  if (isCleanMode) return;
  renderEditorReferenceSourceSummary();
  renderPackagingSummary();
  renderStepFourNextPanel();
  renderGuideCards("ai-summary-preview", buildAiSummaryCards());
  renderGuideCards("fact-check-preview", buildFactCheckCards());
  renderGuideCards("field-brief-preview", buildFieldPackCards());
}

function roleLabel(row) {
  const role = String(row.role || "unused");
  if (role === "cover") return "cover";
  if (role === "inline") return "inline";
  if (role === "gallery") return "gallery";
  return "unused";
}

function roleDisplayLabel(role) {
  const value = String(role || "unused");
  if (value === "cover") return "ภาพปก";
  if (value === "inline") return "ภาพในเนื้อหา";
  if (value === "gallery") return "แกลเลอรี";
  return "ไม่ได้ใช้";
}

function isReferenceMediaRow(row) {
  return Boolean(String(row?.reference_media_id || "").trim());
}

function renderAssetBadges(row, { cleanMode = isCleanMode } = {}) {
  const badges = [];
  if (cleanMode && isReferenceMediaRow(row)) {
    badges.push(
      Number(row?.selected_for_ai || 0) === 1
        ? '<span class="workflow-badge workflow-badge-sent">ส่งให้ Agent</span>'
        : '<span class="muted">ยังไม่ถูกเลือกส่งให้ Agent</span>'
    );
    badges.push('<span class="muted">ภาพอ้างอิงเท่านั้น</span>');
    return badges.join(" ");
  }
  const role = roleLabel(row);
  const selected = Number(row.selected_in_clean || 0) === 1 && role !== "unused";
  const isCover = Number(row.is_cover || 0) === 1 || role === "cover";

  badges.push(`<span class="asset-badge role-${role}">${roleDisplayLabel(role)}</span>`);
  badges.push(`<span class="asset-badge ${selected ? "state-on" : "state-off"}">${selected ? "เลือกแล้ว" : "ยังไม่เลือก"}</span>`);
  if (isCover) {
    badges.push('<span class="asset-badge state-cover">ปก</span>');
  }
  return badges.join(" ");
}

function renderAssetsTable(rows) {
  const table = qs("table-assets");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const canEdit = canEditCurrentItem();
  const editGuard = getEditPermissionGuard();
  const disabledAttr = canEdit ? "" : " disabled";
  const disabledTitleAttr = canEdit ? "" : ` title="${escapeHtml(editGuard.reason || "ไม่มีสิทธิ์แก้ไข")}"`;

  if (!Array.isArray(rows) || !rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = isCleanMode
      ? '<td colspan="6" class="muted">ยังไม่มีรูปอ้างอิงสำหรับ Agent</td>'
      : '<td colspan="6" class="muted">ยังไม่มีไฟล์ asset ที่เลือกไว้สำหรับ AI</td>';
    tbody.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const isReferenceRow = isReferenceMediaRow(row);
    const selected = isReferenceRow
      ? Number(row.selected_for_ai || 0) === 1
      : Number(row.selected_in_clean || 0) === 1 && String(row.role || "") !== "unused";
    const displayName = String(row.file_name || row.storage_path || row.reference_media_id || "-");
    const assetId = Number(row.asset_id || 0) || 0;
    const rowId = isReferenceRow ? String(row.reference_media_id || "").trim() : String(assetId || 0);

    const previewUrl = sanitizeUrl(row.preview_url || row.url || row.public_url || "");
    const preview = previewUrl ? `<img class="asset-thumb" src="${escapeHtml(previewUrl)}" alt="asset" />` : "-";

    const actions = [];
    if (isCleanMode) {
      actions.push(`<button data-action="toggle-select" data-id="${escapeHtml(rowId)}"${disabledAttr}${disabledTitleAttr}>${selected ? "ถอนจาก Agent" : "อนุมัติให้ Agent"}</button>`);
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(rowId || "-")}</td>
      <td>${Number(row.content_item_id) || "-"}</td>
      <td>${renderAssetBadges(row, { cleanMode: isCleanMode })}</td>
      <td class="asset-file-cell"><span class="asset-file-text" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span></td>
      <td>${preview}</td>
      <td>${actions.join(" ") || "-"}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("img.asset-thumb").forEach((img) => {
    const src = img.getAttribute("src") || "";
    setImageWithFallback(img, src);
    img.addEventListener("mouseenter", (event) => showAssetHoverPreview(src, event));
    img.addEventListener("mousemove", (event) => {
      const box = document.getElementById("asset-hover-preview");
      if (box && !box.classList.contains("hidden")) {
        positionAssetHoverPreview(box, event);
      }
    });
    img.addEventListener("mouseleave", hideAssetHoverPreview);
  });

  const resolveAssetUrl = (asset) => {
    if (asset?.preview_url) return String(asset.preview_url).trim();
    if (asset?.url) return String(asset.url).trim();
    if (asset?.public_url) return String(asset.public_url).trim();
    const rawPath = String(asset?.storage_path || "").trim();
    if (!rawPath) return "";
    if (/^https?:\/\//i.test(rawPath)) return rawPath;
    if (rawPath.startsWith("/")) return rawPath;
    return `/${rawPath.replace(/^\.?\//, "")}`;
  };

  tbody.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id || 0);
      const referenceMediaId = String(btn.dataset.id || "").trim();
      const asset = isCleanMode
        ? rows.find((r) => String(r.reference_media_id || "").trim() === referenceMediaId)
        : rows.find((r) => Number(r.asset_id || 0) === id);
      if (!asset) return;
      const url = resolveAssetUrl(asset);
      const action = btn.dataset.action;

      try {
        if (action === "toggle-select") {
          if (isCleanMode) {
            const nextSelected = Number(asset?.selected_for_ai || 0) !== 1;
            await api(`/api/items/${state.itemId}/reference-media/${encodeURIComponent(referenceMediaId)}/selected`, {
              method: "PATCH",
              body: JSON.stringify({ selected: nextSelected }),
            });
            await refreshAssets();
            setAssetStatus(
              nextSelected
                ? `ส่ง asset ${referenceMediaId} ให้ Agent ใช้เป็นภาพอ้างอิงแล้ว`
                : `ถอน asset ${referenceMediaId} ออกจาก Agent แล้ว`
            );
            return;
          }
          const nextSelected = !(Number(asset?.selected_in_clean || 0) === 1 && String(asset?.role || "") !== "unused");
          await api(`/api/items/${state.itemId}/assets/${id}/selected`, {
            method: "PATCH",
            body: JSON.stringify({ selected: nextSelected }),
          });
          await refreshAssets();
          setAssetStatus(nextSelected ? `เลือก asset ${id} แล้ว` : `ยกเลิกเลือก asset ${id} แล้ว`);
          return;
        }

        if (action === "delete-asset") {
          if (!window.confirm(`ลบ asset ${id} ใช่หรือไม่ การลบไม่สามารถย้อนกลับได้`)) return;
          await api(`/api/assets/${id}`, { method: "DELETE" });
          await refreshAssets();
          setAssetStatus(`ลบ asset ${id} แล้ว`);
        }
      } catch (err) {
        setAssetStatus(err.message, true);
      }
    });
  });
}

async function refreshAssets() {
  if (isCleanMode) {
    const [workflowData, referenceRows] = await Promise.all([
      api(`/api/items/${state.itemId}/image-workflow`),
      api(`/api/items/${state.itemId}/reference-media`),
    ]);
    state.imageWorkflow = workflowData?.status || null;
    state.assets = Array.isArray(referenceRows) ? referenceRows : [];
    renderAssetsTable(state.assets);
    renderCleanAiGuard();
    return;
  }

  const rows = await api(`/api/assets?content_item_id=${state.itemId}&only_selected=1`);
  state.assets = Array.isArray(rows) ? rows : [];
  renderAssetsTable(state.assets);
  renderFieldPackMediaHintEditor(state.fieldPack);
  renderStepFourGuides();
}


async function uploadAssetFromPanel() {
  const files = Array.from(qs("asset-file")?.files || []);
  if (!files.length) throw new Error("Please choose file(s) to upload.");

  const requestedRole = qs("asset-role")?.value || "gallery";
  const uploaded = [];

  for (const [index, file] of files.entries()) {
    const form = new FormData();
    const role = requestedRole === "cover" && index > 0 ? "gallery" : requestedRole;
    form.append("file", file);
    form.append("content_item_id", String(state.itemId));
    form.append("role", role);

    const result = await api("/api/assets/upload", { method: "POST", body: form });
    uploaded.push(result);
  }

  return {
    count: uploaded.length,
    coverAdjusted: requestedRole === "cover" && uploaded.length > 1,
  };
}

async function registerAssetFromPanel() {
  const storagePath = String(qs("asset-path")?.value || "").trim();
  if (!storagePath) throw new Error("Please provide a file path or URL.");

  await api("/api/assets/register", {
    method: "POST",
    body: JSON.stringify({
      content_item_id: state.itemId,
      role: qs("asset-role")?.value || "gallery",
      storage_disk: "local",
      storage_path: storagePath,
      file_name: String(qs("asset-filename")?.value || "").trim() || null,
    }),
  });
}

async function syncClaimedItem(resultItem = null) {
  if (resultItem && typeof resultItem === "object") {
    state.item = resultItem;
  } else {
    state.item = await api(`/api/items/${state.itemId}`);
  }
  fillForm(state.item);
  applyEditorActionGuards();
  renderEvidenceTable();
  renderApprovedContextTable();
  renderAssetsTable(state.assets);
  renderFieldPackMediaHintEditor(state.fieldPack);
  renderStepFourGuides();
  renderCleanAiGuard();
}


function wire() {
  ensureMustCaptureEditor();
  qs("btn-close-evidence-value-modal")?.addEventListener("click", () => {
    closeEvidenceValueModal();
  });

  qs("evidence-value-modal")?.addEventListener("click", (event) => {
    if (event.target === qs("evidence-value-modal")) {
      closeEvidenceValueModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeEvidenceValueModal();
  });

  qs("evidence-filter-block-type")?.addEventListener("change", (event) => {
    state.evidenceView.blockType = String(event.target?.value || "all").trim() || "all";
    renderEvidenceTable();
  });

  qs("evidence-filter-source-family")?.addEventListener("change", (event) => {
    state.evidenceView.sourceFamily = String(event.target?.value || "all").trim() || "all";
    renderEvidenceTable();
  });

  qs("evidence-sort")?.addEventListener("change", (event) => {
    state.evidenceView.sort = String(event.target?.value || "source_priority").trim() || "source_priority";
    renderEvidenceTable();
  });

  const prevStepBtn = qs("btn-prev-step");
  if (prevStepBtn) prevStepBtn.textContent = isCleanMode ? "กลับไปขั้นก่อนหน้า (Clean)" : "กลับไปขั้นก่อนหน้า";
  const backBtn = qs("btn-back");
  if (backBtn) backBtn.textContent = "กลับ";
  const nextAiBtn = qs("btn-next-ai");
  if (nextAiBtn) nextAiBtn.textContent = "ถัดไป: ส่งเข้า Agent";
  const nextExportBtn = qs("btn-next-export");
  if (nextExportBtn) nextExportBtn.textContent = "ไปขั้นส่งต่อ handoff";

  qs("btn-prev-step")?.addEventListener("click", () => {
    window.location.href = getPreviousStepUrl();
  });

  qs("btn-back")?.addEventListener("click", async () => {
    const targetUrl = await getBackNavigationUrl();
    window.location.assign(targetUrl);
  });

  qs("btn-open-field-brief")?.addEventListener("click", () => {
    window.location.href = `/field-brief.html?id=${state.itemId}`;
  });

  qs("btn-item-claim")?.addEventListener("click", async () => {
    try {
      const result = await api(`/api/items/${state.itemId}/claim`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await syncClaimedItem(result?.item || null);
      setStatus(`Claim item #${state.itemId} แล้ว`);
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  qs("btn-item-release")?.addEventListener("click", async () => {
    try {
      if (!window.confirm(`ยืนยันปล่อย claim ของ item #${state.itemId} หรือไม่`)) return;
      const result = await api(`/api/items/${state.itemId}/release`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await syncClaimedItem(result?.item || null);
      setStatus(`ปล่อย claim item #${state.itemId} แล้ว`);
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  qs("btn-item-takeover")?.addEventListener("click", async () => {
    try {
      if (!window.confirm(`ยืนยัน Take over item #${state.itemId} หรือไม่`)) return;
      const result = await api(`/api/items/${state.itemId}/takeover`, {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      await syncClaimedItem(result?.item || null);
      setStatus(`Take over item #${state.itemId} แล้ว`);
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  async function saveCurrentItem(workflowAction = null) {
    const editGuard = getEditPermissionGuard();
    if (!editGuard.allowed) {
      throw new Error(editGuard.reason);
    }
    const payload = buildPayload();
    if (!payload.title || !payload.description_raw) {
      throw new Error("Title and description are required before saving.");
    }
    if (workflowAction) payload.workflow_action = workflowAction;

    const result = await api(`/api/items/${state.itemId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    state.item = result?.item || { ...(state.item || {}), ...payload };
    applyEditorActionGuards();
    return state.item;
  }

  async function saveCurrentWork(workflowAction = null) {
    const editGuard = getEditPermissionGuard();
    if (!editGuard.allowed) {
      throw new Error(editGuard.reason);
    }
    if (isCleanMode) {
      await saveCurrentItem(workflowAction);
      return null;
    }
    const payload = buildEditorWorkPayload(workflowAction);
    const result = await api(`/api/items/${state.itemId}/editor-work`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    state.item = result?.item || { ...(state.item || {}), ...(payload.item || {}) };
    state.fieldPack = result?.field_pack || state.fieldPack;
    applyEditorActionGuards();
    fillFieldPackForm(state.fieldPack);
    renderStepFourGuides();
    return state.fieldPack;
  }

  qs("btn-save")?.addEventListener("click", async () => {
    try {
      const editGuard = getEditPermissionGuard();
      if (!editGuard.allowed) {
        applyEditorActionGuards();
        setStatus(editGuard.reason, true);
        return;
      }
      const workflowAction = qs("btn-next-ai") ? "mark_cleaned" : null;
      await saveCurrentWork(workflowAction);
      setStatus(qs("btn-next-ai") ? `บันทึกงานและอัปเดตสถานะแล้ว (ID ${state.itemId})` : `บันทึกงานแล้ว (ID ${state.itemId})`);
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  qs("btn-save-ai-context")?.addEventListener("click", () => {
    const saveBtn = qs("btn-save");
    if (!saveBtn) return;
    saveBtn.click();
  });

  qs("btn-return-to-clean")?.addEventListener("click", async (event) => {
    const btn = event.currentTarget;
    try {
      const editGuard = getEditPermissionGuard();
      if (!editGuard.allowed) {
        applyEditorActionGuards();
        setFieldPackRegenerateStatus(editGuard.reason, true);
        return;
      }
      const note = String(qs("fp-return-to-clean-note")?.value || "").trim();
      if (!note) {
        setFieldPackRegenerateStatus("กรุณากรอกเหตุผลก่อนส่งกลับไป Clean", true);
        return;
      }
      if (!window.confirm("ยืนยันส่งกลับไปหน้า Clean ระบบจะลบ field pack ปัจจุบันและไม่ generate ใหม่อัตโนมัติ")) {
        return;
      }
      await withButtonLoading(btn, "กำลังส่งกลับ...", async () => {
        setFieldPackRegenerateStatus("กำลังส่งกลับไปหน้า Clean...");
        const result = await returnCurrentFieldPackToClean(note);
        const redirectUrl = String(result?.redirect_url || "").trim() || `/clean-item.html?id=${state.itemId}`;
        window.location.href = redirectUrl;
      });
    } catch (err) {
      setFieldPackRegenerateStatus(err.message, true);
      setStatus(`ส่งกลับไป Clean ไม่สำเร็จ: ${err.message}`, true);
    }
  });

  qs("btn-next-ai")?.addEventListener("click", async () => {
    try {
      const editGuard = getEditPermissionGuard();
      if (!editGuard.allowed) {
        applyEditorActionGuards();
        setStatus(editGuard.reason, true);
        return;
      }
      await runWithPageBusy("กำลังเตรียมส่งเข้า Agent...", async () => {
        if (isCleanMode) {
          await runAiDraftFromApprovedContext(saveCurrentItem);
          return;
        }

        setStatus("กำลังรัน Agent...");
        await saveCurrentItem();

        const aiResult = await api("/api/run/ai-draft", {
          method: "POST",
          body: JSON.stringify({ mode: "ai", allowFallback: false, content_item_id: state.itemId }),
        });

        setStatus(`Agent สร้าง draft แล้ว (${aiResult.count || 0} รายการ) กำลังไป Step 4 เพื่อรีวิวผล...`);
        setTimeout(() => {
          window.location.href = `/item-editor.html?id=${state.itemId}`;
        }, 350);
      });
    } catch (err) {
      setStatus(`Agent ทำงานไม่สำเร็จ: ${err.message}`, true);
    }
  });

  qs("btn-next-export")?.addEventListener("click", async () => {
    try {
      const editGuard = getEditPermissionGuard();
      if (!editGuard.allowed) {
        applyEditorActionGuards();
        setStatus(editGuard.reason, true);
        return;
      }
      const guard = getEditorAssignmentGuard();
      if (!guard.allowed) {
        applyEditorActionGuards();
        setStatus(guard.reason, true);
        return;
      }
      setStatus("กำลังบันทึกและส่งต่อไปคิว handoff...");
      await saveCurrentWork();
      window.location.href = `/?tab=handoff&item_id=${state.itemId}`;
    } catch (err) {
      setStatus(`ส่งต่อ handoff ไม่สำเร็จ: ${err.message}`, true);
    }
  });

  qs("e-image")?.addEventListener("input", () => {
    updateCoverPreview();
    renderStepFourGuides();
  });
  qs("e-title")?.addEventListener("input", () => {
    renderStepFourGuides();
    renderCleanAiGuard();
  });
  qs("e-description")?.addEventListener("input", renderStepFourGuides);
  qs("e-tags")?.addEventListener("input", renderStepFourGuides);
  qs("e-category")?.addEventListener("change", renderStepFourGuides);
  qs("e-source-name")?.addEventListener("input", () => {
    renderStepFourGuides();
    renderCleanAiGuard();
  });
  qs("e-source-url")?.addEventListener("input", () => {
    renderStepFourGuides();
    renderCleanAiGuard();
  });
  [
    "fp-status",
    "fp-writer-ready",
    "fp-ai-summary",
    "fp-ai-highlights",
    "fp-ai-unknowns",
    "fp-editor-summary",
    "fp-verified-facts",
    "fp-uncertain-facts",
    "fp-story-angle",
    "fp-field-notes",
    "fp-must-verify-facts",
    "fp-must-capture-shots",
    "fp-must-ask-questions",
    "fp-social-hook",
    "fp-social-shot-emphasis",
    "fp-social-on-camera-points",
    "fp-social-caption-angle",
    "fp-requested-checks-editor",
    "fp-references",
    "fp-writer-references",
    "fp-external-media-hints",
    "fp-field-assignment-id",
    "fp-field-assigned-name",
    "fp-field-assigned-role",
    "fp-field-due-at",
    "fp-field-assignment-note",
    "fp-writer-assignment-id",
    "fp-writer-assigned-name",
    "fp-writer-assigned-role",
    "fp-writer-due-at",
    "fp-writer-assignment-note",
  ].forEach((id) => {
    const node = qs(id);
    if (!node) return;
    const eventName = node.type === "checkbox" || node.tagName === "SELECT" ? "change" : "input";
    node.addEventListener(eventName, () => {
      if (node instanceof HTMLTextAreaElement) autosizeTextarea(node);
      applyEditorActionGuards();
      renderStepFourGuides();
    });
  });
  qs("fp-must-capture-editor")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.id === "btn-must-capture-add") {
      const nextType = normalizeCaptureType(qs("must-capture-add-type")?.value, "photo");
      const textNode = qs("must-capture-add-text");
      const nextText = String(textNode?.value || "").trim();
      if (textNode) textNode.value = "";
      addMustCaptureEditorRow(nextType, nextText);
      applyEditorActionGuards();
      renderStepFourGuides();
      return;
    }
    if (target.classList.contains("must-capture-remove")) {
      const row = target.closest(".must-capture-row");
      if (row) row.remove();
      syncMustCaptureEditorShadowValue();
      if (!getMustCaptureEditorRows().length) {
        renderMustCaptureEditor([]);
      }
      applyEditorActionGuards();
      renderStepFourGuides();
    }
  });
  qs("fp-must-capture-editor")?.addEventListener("input", () => {
    syncMustCaptureEditorShadowValue();
    applyEditorActionGuards();
    renderStepFourGuides();
  });
  qs("fp-must-capture-editor")?.addEventListener("change", () => {
    syncMustCaptureEditorShadowValue();
    applyEditorActionGuards();
    renderStepFourGuides();
  });
  qs("fp-media-hints-editor")?.addEventListener("input", renderStepFourGuides);
  qs("fp-media-hints-editor")?.addEventListener("change", renderStepFourGuides);
  qs("fp-requested-checks-editor")?.addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) autosizeTextarea(target);
    applyEditorActionGuards();
    renderStepFourGuides();
    renderRequestedChecksPreview();
  });
  qs("fp-requested-checks-editor")?.addEventListener("change", () => {
    applyEditorActionGuards();
    renderStepFourGuides();
    renderRequestedChecksPreview();
  });
  qs("fp-requested-checks-editor")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const groupNode = target.closest("[data-requested-group]");
    if (!groupNode) return;
    if (target.getAttribute("data-action") === "add-requested-check") {
      const current = readRequestedChecksEditorState();
      const customGroup = current.groups.find((group) => group.group_key === "custom");
      const nextIndex = Array.isArray(customGroup?.checks) ? customGroup.checks.length + 1 : 1;
      if (!customGroup) {
        current.groups.push({ group_key: "custom", group_label: "เช็กเพิ่ม", checks: [] });
      }
      current.groups.find((group) => group.group_key === "custom").checks.push({
        key: `custom_${nextIndex}`,
        requested: false,
        label: "",
        instruction: "",
        answer_type: "text",
        suggested_value: null,
        condition_prompt: null,
        evidence_required: false,
        source: null,
      });
      renderRequestedChecksEditor({ requested_checks_json: current });
      applyEditorActionGuards();
      renderStepFourGuides();
      renderRequestedChecksPreview();
      return;
    }
    if (target.getAttribute("data-action") === "remove-requested-check") {
      target.closest("[data-requested-check-row]")?.remove();
      applyEditorActionGuards();
      renderStepFourGuides();
      renderRequestedChecksPreview();
    }
  });



  if (isCleanMode) {
    qs("btn-toggle-manual-evidence")?.addEventListener("click", () => {
      const panel = qs("manual-evidence-panel");
      const btn = qs("btn-toggle-manual-evidence");
      if (!panel || !btn) return;
      const opening = panel.classList.contains("hidden");
      panel.classList.toggle("hidden", !opening);
      btn.textContent = opening ? "ซ่อนฟอร์มเพิ่ม Evidence แบบ Manual" : "แสดงฟอร์มเพิ่ม Evidence แบบ Manual";
    });

    qs("btn-add-evidence")?.addEventListener("click", async () => {
      try {
        const editGuard = getEditPermissionGuard();
        if (!editGuard.allowed) {
          applyEditorActionGuards();
          setEvidenceStatus(editGuard.reason, true);
          return;
        }
        const payloads = buildEvidenceBatchPayloads();
        for (const payload of payloads) {
          await api(`/api/items/${state.itemId}/evidence-blocks`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
        }
        clearEvidenceForm();
        await loadEvidenceContextAndPreview();
        setEvidenceStatus(`เพิ่ม Raw Evidence แล้ว ${payloads.length} รายการ`);
      } catch (err) {
        setEvidenceStatus(err.message, true);
      }
    });

    qs("btn-add-evidence-advanced")?.addEventListener("click", async () => {
      try {
        const editGuard = getEditPermissionGuard();
        if (!editGuard.allowed) {
          applyEditorActionGuards();
          setEvidenceStatus(editGuard.reason, true);
          return;
        }
        const payload = buildEvidencePayloadFromForm();
        await api(`/api/items/${state.itemId}/evidence-blocks`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        clearEvidenceForm();
        await loadEvidenceContextAndPreview();
        setEvidenceStatus("เพิ่ม Evidence สำเร็จ");
      } catch (err) {
        setEvidenceStatus(err.message, true);
      }
    });

    qs("btn-refresh-draft-preview")?.addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      try {
        await withButtonLoading(btn, "กำลังรีเฟรช...", async () => {
          await loadEvidenceContextAndPreview();
        });
        setDraftPreviewStatus("รีเฟรช draft preview จาก Agent แล้ว");
      } catch (err) {
        setDraftPreviewStatus(err.message, true);
      }
    });

    qs("btn-run-ai-context")?.addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      try {
        const editGuard = getEditPermissionGuard();
        if (!editGuard.allowed) {
          applyEditorActionGuards();
          setStatus(editGuard.reason, true);
          return;
        }
        await runWithPageBusy("กำลังรัน Agent...", async () => {
          await withButtonLoading(btn, "กำลังรัน Agent...", async () => {
            await runAiDraftFromApprovedContext(saveCurrentItem);
          });
        });
      } catch (err) {
        setStatus(`Agent ทำงานไม่สำเร็จ: ${err.message}`, true);
      }
    });

    qs("asset-file")?.addEventListener("change", updateSelectedFileSummary);
    updateSelectedFileSummary();

    qs("btn-upload-asset")?.addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      try {
        const editGuard = getEditPermissionGuard();
        if (!editGuard.allowed) {
          applyEditorActionGuards();
          setAssetStatus(editGuard.reason, true);
          return;
        }
        setAssetStatus("Uploading images...");
        const result = await withButtonLoading(btn, "กำลังอัปโหลด...", async () => uploadAssetFromPanel());
        if (qs("asset-file")) qs("asset-file").value = "";
        updateSelectedFileSummary();
        await refreshAssets();

        const suffix = result.coverAdjusted ? " (first image is cover, remaining are gallery)" : "";
        setAssetStatus("Uploaded " + result.count + " image(s) successfully" + suffix);
      } catch (err) {
        setAssetStatus(err.message, true);
      }
    });

    qs("btn-register-asset")?.addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      try {
        const editGuard = getEditPermissionGuard();
        if (!editGuard.allowed) {
          applyEditorActionGuards();
          setAssetStatus(editGuard.reason, true);
          return;
        }
        await withButtonLoading(btn, "กำลังลงทะเบียน...", async () => registerAssetFromPanel());
        if (qs("asset-path")) qs("asset-path").value = "";
        if (qs("asset-filename")) qs("asset-filename").value = "";
        await refreshAssets();
        setAssetStatus("Registered asset path/URL successfully.");
      } catch (err) {
        setAssetStatus(err.message, true);
      }
    });
  }
}
(async () => {
  try {
    const me = await api("/api/auth/me");
    state.user = me.user;
    qs("editor-auth-status").textContent = "";

    if (!state.itemId) throw new Error("Missing item id");

    if (String(state.user?.role || "").trim().toLowerCase() === "freelance") {
      window.location.replace(await resolveFreelanceEditorExitUrl());
      return;
    }

    wire();
    const item = await api(`/api/items/${state.itemId}`);
    state.item = item;
    const workflowStatus = getItemWorkflowCompatStatus(item);
    if (!isCleanMode && (workflowStatus === "cleaned" || workflowStatus === "raw") && !isStepFourEligibleItem(item)) {
      window.location.replace(`/clean-item.html?id=${state.itemId}`);
      return;
    }
    fillForm(item);
    applyEditorActionGuards();
    if (qs("asset-item-id")) qs("asset-item-id").value = String(state.itemId);
    await refreshAssets();
    await loadCurrentFieldPack();
    await loadItemAssignmentsForStep4();
    if (isCleanMode) {
      await loadEvidenceContextAndPreview();
    }
    renderStepFourGuides();
    setStatus(`เปิด item ${state.itemId} สำเร็จ`);
  } catch (err) {
    setStatus(err.message, true);
  }
})();

