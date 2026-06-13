import {
  api,
  canApproveArticle,
  canManageTranslations,
  canSyncArticle,
  articleStatusLabel,
  currentAssignments,
  currentReviewNote,
  currentRole,
  escapeHtml,
  formatDateTime,
  getArticleStatus,
  latestDraft,
  loadTranslations,
  loadWorkspace,
  primaryAssignment,
  qs,
  renderActivityLog,
  renderAuthStatus,
  renderProcessBar,
  eventReviewPreviewUrl,
  eventWorkspaceUrl,
  setBanner,
  setInlineStatus,
  state,
} from "./article-workflow-core.js";

function preferredRevisionAssignment() {
  const rows = [];
  const primary = primaryAssignment();
  if (primary) rows.push(primary);
  for (const row of currentAssignments()) {
    if (!row) continue;
    const id = Number(row.id || 0) || 0;
    if (!id || rows.some((candidate) => Number(candidate?.id || 0) === id)) continue;
    rows.push(row);
  }
  const preferredStates = ["submitted", "resubmitted", "accepted", "revision_requested", "in_progress", "assigned"];
  for (const stateName of preferredStates) {
    const match = rows.find((row) => String(row?.state || "").trim().toLowerCase() === stateName);
    if (match) return match;
  }
  return rows[0] || null;
}

function eventFallbackUrl() {
  const role = currentRole();
  const normalizedItemId = Number(state.itemId || 0) || 0;
  if (role === "editor") {
    return normalizedItemId > 0 ? `/editor-home.html?item_id=${normalizedItemId}` : "/editor-home.html";
  }
  if (role !== "freelance") return "/events-manager.html";
  if (role === "freelance") return "/?tab=work";
  return "/events-manager.html";
}

function ensureEventItem() {
  if (String(state.item?.type || "").trim().toLowerCase() === "event") return true;
  window.location.replace(eventFallbackUrl());
  return false;
}

function collectEventWorkspacePayload() {
  const item = state.item || {};
  const draft = latestDraft();
  return {
    item: {
      title: String(draft?.draft_title || item.title || "").trim(),
      summary: String(draft?.excerpt || item.summary || "").trim(),
      slug: String(item.slug || "").trim(),
      meta_title: String(draft?.meta_title || item.meta_title || "").trim(),
      meta_description: String(draft?.meta_description || item.meta_description || "").trim(),
      event_period_text: String(item.event_period_text || "").trim(),
      location_text: String(item.location_text || "").trim(),
      map_url: String(item.map_url || "").trim(),
      description_clean: String(draft?.body || item.description_clean || item.description_raw || "").trim(),
    },
  };
}

function validateEventWorkspace() {
  const payload = collectEventWorkspacePayload();
  const missing = [];
  if (!payload.item.title) missing.push("title");
  if (!payload.item.summary) missing.push("summary");
  if (!payload.item.slug) missing.push("slug");
  if (!payload.item.meta_title) missing.push("meta title");
  if (!payload.item.meta_description) missing.push("meta description");
  if (!payload.item.event_period_text) missing.push("event period");
  if (!payload.item.location_text) missing.push("location");
  if (!payload.item.description_clean) missing.push("body");
  const hasCover = (Array.isArray(state.assets) ? state.assets : []).some((row) => Number(row.is_cover || 0) === 1 || String(row.role || "") === "cover");
  if (!hasCover) missing.push("cover image");
  return { ok: missing.length === 0, missing };
}

function setBusy(isBusy) {
  state.busy = Boolean(isBusy);
  [
    "btn-request-revision",
    "btn-approve-sync",
    "btn-refresh-readiness",
    "btn-send-main-site",
    "btn-generate-translations",
  ].forEach((id) => {
    const node = qs(id);
    if (node) node.disabled = state.busy;
  });
}

function setTranslationGenerateLoading(isLoading) {
  const button = qs("btn-generate-translations");
  const stateNode = qs("translation-generate-state");
  if (button) {
    button.classList.toggle("is-loading", Boolean(isLoading));
    button.setAttribute("aria-busy", isLoading ? "true" : "false");
  }
  if (!stateNode) return;
  if (isLoading) {
    stateNode.textContent = "กำลังสร้างคำแปล...";
    stateNode.className = "translation-generate-state";
    return;
  }
  stateNode.textContent = "";
  stateNode.className = "translation-generate-state hidden";
}

function normalizeReviewActionCopy() {
  const status = getArticleStatus();
  const alreadySubmitted = status === "submitted_for_admin_review";
  const reviewDescription = document.querySelector(".article-card-review > .article-section-head .muted");
  if (reviewDescription) {
    reviewDescription.textContent = "ตรวจทานความถูกต้องของเนื้อหาอีเวนต์ก่อนอนุมัติและส่งเข้า Admin Review";
  }

  const approveBtn = qs("btn-approve-sync");
  if (approveBtn) {
    approveBtn.textContent = "อนุมัติและส่งเข้า Admin Review";
  }

  const syncDescription = document.querySelector(".article-review-sync-controls .article-section-head .muted");
  if (syncDescription) {
    syncDescription.textContent = alreadySubmitted
      ? "รายการนี้ถูกส่งเข้า Admin Review แล้ว"
      : "รายการนี้จะถูกส่งไปยังขั้นตอน Admin Review";
  }

  const syncBtn = qs("btn-send-main-site");
  if (syncBtn) {
    syncBtn.textContent = alreadySubmitted ? "ส่งเข้า Admin Review แล้ว" : "ส่งเข้า Admin Review";
  }
}

function renderReviewFields() {
  const noteNode = qs("review-note");
  if (noteNode) {
    noteNode.value = String(state.articleProcess?.workflow_model?.last_transition_note || "");
  }
}

function renderReviewChecklist() {
  const root = qs("review-checklist");
  if (!root) return;
  const payload = collectEventWorkspacePayload();
  const body = String(payload.item.description_clean || "").trim();
  const hasCover = (Array.isArray(state.assets) ? state.assets : []).some((row) => Number(row.is_cover || 0) === 1 || String(row.role || "") === "cover");
  const checks = [
    { label: "ชื่อ Event", pass: Boolean(payload.item.title) },
    { label: "สรุปย่อ", pass: Boolean(payload.item.summary) },
    { label: "Slug", pass: Boolean(payload.item.slug) },
    { label: "Meta Title", pass: Boolean(payload.item.meta_title) },
    { label: "Meta Description", pass: Boolean(payload.item.meta_description) },
    { label: "Event Period", pass: Boolean(payload.item.event_period_text) },
    { label: "Location", pass: Boolean(payload.item.location_text) },
    { label: "เนื้อหา", pass: Boolean(body) },
    { label: "ภาพปก", pass: hasCover },
  ];
  root.innerHTML = checks.map((row) => `
    <label class="article-check-item">
      <input type="checkbox" disabled ${row.pass ? "checked" : ""} />
      <span>${escapeHtml(row.label)}</span>
    </label>
  `).join("");
}

function renderSyncSummary() {
  const root = qs("sync-summary");
  if (!root) return;
  const readiness = state.readiness || null;
  const status = getArticleStatus();
  root.classList.remove("hidden");
  if (!readiness) {
    root.innerHTML = `
      <div class="summary-row"><strong>สถานะการส่งต่อ</strong><span>${escapeHtml(status === "synced_to_admin" ? "เผยแพร่แล้วบนเว็บหลัก" : status === "submitted_for_admin_review" ? "ส่งเข้า Admin Review แล้ว" : "ยังไม่ได้ประเมินความพร้อม")}</span></div>
      <div class="summary-row"><strong>ความพร้อมของต้นฉบับ</strong><span class="${status === "ready_for_sync" || status === "submitted_for_admin_review" || status === "synced_to_admin" ? "ok" : "warn"}">${status === "synced_to_admin" ? "เผยแพร่แล้ว" : status === "ready_for_sync" || status === "submitted_for_admin_review" ? "พร้อมส่งต่อ" : "รอตรวจสอบ"}</span></div>
    `;
    return;
  }
  const issues = Array.isArray(readiness.source_issues) ? readiness.source_issues : [];
  root.innerHTML = `
    <div class="summary-row"><strong>ความพร้อมของต้นฉบับ</strong><span class="${readiness.source_ready ? "ok" : "fail"}">${readiness.source_ready ? "พร้อม" : "ยังไม่พร้อม"}</span></div>
    <div class="summary-row"><strong>สถานะการส่งต่อ</strong><span>${escapeHtml(status === "synced_to_admin" ? "เผยแพร่แล้วบนเว็บหลัก" : status === "submitted_for_admin_review" ? "ส่งเข้า Admin Review แล้ว" : status === "ready_for_sync" ? "พร้อมส่งเข้า Admin Review" : "ยังไม่พร้อมส่งต่อ")}</span></div>
    ${isCollectorLockedAfterAdminReview(status) ? '<p class="warn">ส่งเข้า Admin Review แล้ว - รอการจัดการต่อใน Admin Panel</p>' : ""}
    ${issues.length ? `<ul>${issues.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>` : '<p class="muted">ไม่พบปัญหาเพิ่มเติม</p>'}
  `;
}

function translationSummaryCounts(rows) {
  const counts = { passed: 0, failed: 0, stale: 0, not_ready: 0, total: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const status = String(row?.status || "").trim().toLowerCase() || "not_ready";
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    counts.total += 1;
  }
  return counts;
}

function translationStatusFromRepoRow(row) {
  if (Number(row?.stale_flag || 0) === 1) return "stale";
  if (
    String(row?.translation_status || "").trim().toLowerCase() === "ready"
    && String(row?.automatic_check_status || "").trim().toLowerCase() === "passed"
  ) {
    return "passed";
  }
  if (
    /failed|check_failed/i.test(String(row?.translation_status || ""))
    || String(row?.automatic_check_status || "").trim().toLowerCase() === "failed"
  ) {
    return "failed";
  }
  return "not_ready";
}

function translationIssuesFromRow(row) {
  const issues = Array.isArray(row?.automatic_check_report?.issues) ? row.automatic_check_report.issues : [];
  return issues.map((issue) => String(issue || "").trim()).filter(Boolean);
}

function translationFailureReasonFromRow(row) {
  return String(row?.automatic_check_report?.failure_reason || "").trim().toLowerCase() || "";
}

function summarizeTranslationFailures(rows) {
  const failures = (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.status || "").trim().toLowerCase() === "failed")
    .map((row) => {
      const lang = String(row?.lang || "").trim().toUpperCase();
      const failureReason = String(row?.failure_reason || "").trim() || "translation_failed";
      return lang ? `${lang}: ${failureReason}` : failureReason;
    });
  return failures.join(", ");
}

function buildRepoTranslationStatusRows() {
  return (Array.isArray(state.translations) ? state.translations : []).map((row) => ({
    lang: String(row?.lang || "").trim().toLowerCase(),
    status: translationStatusFromRepoRow(row),
    translation_status: String(row?.translation_status || "").trim().toLowerCase() || "-",
    automatic_check_status: String(row?.automatic_check_status || "").trim().toLowerCase() || "-",
    failure_reason: translationFailureReasonFromRow(row),
    issues: translationIssuesFromRow(row),
    updated_at: row?.updated_at || null,
  }));
}

function mergeTranslationReadinessRows(readinessRows, liveRows) {
  const existingRows = Array.isArray(readinessRows) ? readinessRows : [];
  const repoRows = Array.isArray(liveRows) ? liveRows : [];
  if (!existingRows.length) return repoRows;

  const repoByLang = new Map(
    repoRows
      .map((row) => ({
        lang: String(row?.lang || "").trim().toLowerCase(),
        status: String(row?.status || "not_ready").trim().toLowerCase() || "not_ready",
      }))
      .filter((row) => row.lang)
      .map((row) => [row.lang, row]),
  );

  const merged = existingRows.map((row) => {
    const lang = String(row?.lang || "").trim().toLowerCase();
    const existingStatus = String(row?.status || "not_ready").trim().toLowerCase() || "not_ready";
    const live = repoByLang.get(lang);
    if (live) return { lang, status: live.status };
    return { lang, status: existingStatus === "passed" ? "not_ready" : existingStatus };
  });

  const existingLangs = new Set(merged.map((row) => row.lang).filter(Boolean));
  for (const row of repoRows) {
    const lang = String(row?.lang || "").trim().toLowerCase();
    if (!lang || existingLangs.has(lang)) continue;
    merged.push({
      lang,
      status: String(row?.status || "not_ready").trim().toLowerCase() || "not_ready",
    });
  }
  return merged;
}

function buildTranslationRows() {
  const readinessRows = Array.isArray(state.readiness?.translations) ? state.readiness.translations : [];
  const repoRows = Array.isArray(state.translations) ? state.translations : [];
  const repoByLang = new Map(repoRows.map((row) => [String(row?.lang || "").trim().toLowerCase(), row]));

  if (readinessRows.length) {
    return readinessRows.map((row) => {
      const lang = String(row?.lang || "").trim().toLowerCase();
      const live = repoByLang.get(lang) || null;
      return {
        lang,
        status: String(row?.status || "not_ready").trim().toLowerCase(),
        translation_status: String(live?.translation_status || "").trim().toLowerCase() || "-",
        automatic_check_status: String(live?.automatic_check_status || "").trim().toLowerCase() || "-",
        failure_reason: translationFailureReasonFromRow(live),
        issues: translationIssuesFromRow(live),
        updated_at: live?.updated_at || null,
      };
    });
  }

  return buildRepoTranslationStatusRows();
}

function getTranslationGateState() {
  const rows = buildTranslationRows();
  const counts = translationSummaryCounts(rows);
  const blockingRows = rows.filter((row) => String(row?.status || "").trim().toLowerCase() !== "passed");
  const blockingLangs = blockingRows
    .map((row) => String(row?.lang || "").trim().toUpperCase())
    .filter(Boolean);
  return {
    rows,
    counts,
    blockingRows,
    blockingLangs,
    allReady: rows.length > 0 && blockingRows.length === 0,
  };
}

function findTranslationGateRow(lang) {
  const target = String(lang || "").trim().toLowerCase();
  if (!target) return null;
  return getTranslationGateState().rows.find((row) => String(row?.lang || "").trim().toLowerCase() === target) || null;
}

function openTranslationDetail(lang) {
  const row = findTranslationGateRow(lang);
  const modal = qs("translation-detail-modal");
  const body = qs("translation-detail-body");
  const title = qs("translation-detail-title");
  if (!modal || !body || !title || !row) return;
  const issues = Array.isArray(row.issues) ? row.issues : [];
  title.textContent = `รายละเอียดคำแปล: ${String(row.lang || "-").toUpperCase()}`;
  body.innerHTML = `
    <div class="translation-detail-grid">
      <div class="translation-detail-item">
        <strong>ภาษา</strong>
        <span>${escapeHtml(String(row.lang || "-").toUpperCase())}</span>
      </div>
      <div class="translation-detail-item">
        <strong>สถานะ</strong>
        <span class="${row.status === "passed" ? "ok" : row.status === "failed" ? "fail" : row.status === "stale" ? "warn" : "muted"}">${escapeHtml(row.status)}</span>
      </div>
      <div class="translation-detail-item">
        <strong>translation_status</strong>
        <span>${escapeHtml(String(row.translation_status || "-"))}</span>
      </div>
      <div class="translation-detail-item">
        <strong>automatic_check</strong>
        <span>${escapeHtml(String(row.automatic_check_status || "-"))}</span>
      </div>
      <div class="translation-detail-item">
        <strong>failure_reason</strong>
        <span>${escapeHtml(String(row.failure_reason || "-"))}</span>
      </div>
      <div class="translation-detail-item full-span">
        <strong>เวลาอัปเดต</strong>
        <span>${escapeHtml(formatDateTime(row.updated_at))}</span>
      </div>
      <div class="translation-detail-item full-span">
        <strong>ปัญหา</strong>
        ${issues.length ? `<ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : '<p class="muted">ไม่พบปัญหาคำแปลเพิ่มเติม</p>'}
      </div>
    </div>
  `;
  modal.classList.remove("hidden");
}

function closeTranslationDetail() {
  qs("translation-detail-modal")?.classList.add("hidden");
}

function renderTranslationSummary() {
  const root = qs("translation-summary");
  if (!root) return;
  const gate = getTranslationGateState();
  const rows = gate.rows;
  root.classList.remove("hidden");

  if (!rows.length) {
    root.innerHTML = `
      <div class="summary-row"><strong>สถานะ</strong><span class="fail">ยังไม่พร้อม</span></div>
      <div class="summary-row"><strong>ภาษาที่รอ</strong><span>ยังไม่มีคำแปลที่ตรวจได้</span></div>
      <p class="muted">สร้างคำแปลก่อนแล้วค่อยตรวจความพร้อม</p>
    `;
    return;
  }

  root.innerHTML = `
    <div class="summary-row"><strong>สถานะ</strong><span class="${gate.allReady ? "ok" : "fail"}">${escapeHtml(gate.allReady ? "พร้อมทั้งหมด" : `ยังติด: ${gate.blockingLangs.join(", ")}`)}</span></div>
    <div class="article-translation-list">
      ${rows.map((row) => `
        <div class="article-translation-row" role="button" tabindex="0" data-translation-detail="${escapeHtml(String(row.lang || ""))}">
          <strong>${escapeHtml(row.lang || "-")}</strong>
          <span class="${row.status === "passed" ? "ok" : row.status === "failed" ? "fail" : row.status === "stale" ? "warn" : "muted"}">${escapeHtml(row.status)}</span>
        </div>
      `).join("")}
    </div>
    ${gate.allReady ? "" : "<p class=\"muted\">ต้องให้ทุกภาษะอยู่สถานะ passed ก่อนอนุมัติ</p>"}
  `;
}
function renderTranslationReviewSummary() {
  const root = qs("translation-review-summary");
  if (!root) return;
  const gate = getTranslationGateState();
  if (!gate.rows.length) {
    root.innerHTML = `
      <div class="article-translation-review-head">
        <strong>สถานะคำแปล</strong>
        <span class="fail">ยังไม่พร้อม</span>
      </div>
      <p class="muted">ตรวจคำแปลให้ครบก่อนส่งต่อ</p>
    `;
    return;
  }
  root.innerHTML = `
    <div class="article-translation-review-head">
      <strong>สถานะคำแปล</strong>
      <span class="${gate.allReady ? "ok" : "fail"}">${gate.allReady ? "พร้อมส่งต่อ" : `ติด ${gate.blockingLangs.join(", ")}`}</span>
    </div>
    <div class="article-translation-review-list">
      ${gate.rows.map((row) => `
        <div class="article-translation-review-row" role="button" tabindex="0" data-translation-detail="${escapeHtml(String(row.lang || ""))}">
          <strong>${escapeHtml(String(row.lang || "-").toUpperCase())}</strong>
          <span class="${row.status === "passed" ? "ok" : row.status === "failed" ? "fail" : row.status === "stale" ? "warn" : "muted"}">${escapeHtml(row.status)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function isCollectorLockedAfterAdminReview(status = getArticleStatus()) {
  const normalized = String(status || "").trim().toLowerCase();
  return normalized === "submitted_for_admin_review" || normalized === "synced_to_admin";
}

function lockedCollectorWorkflowMessage() {
  return "งานนี้ถูกส่งเข้า Admin Review แล้ว ไม่สามารถส่งกลับ workflow จาก Collector ได้";
}

function lockedTranslationMessage() {
  return "งานนี้ถูกส่งเข้า Admin Review แล้ว ไม่สามารถแก้คำแปลจาก Collector ได้";
}

function applyActionGuards() {
  const status = getArticleStatus();
  const alreadySubmitted = status === "submitted_for_admin_review";
  const locked = isCollectorLockedAfterAdminReview(status);
  const validation = validateEventWorkspace();
  const translationGate = getTranslationGateState();

  const revisionBtn = qs("btn-request-revision");
  if (revisionBtn) revisionBtn.disabled = state.busy || locked || !canApproveArticle() || !["ready_for_review", "ready_for_sync"].includes(status);

  const approveBtn = qs("btn-approve-sync");
  if (approveBtn) approveBtn.disabled = state.busy || locked || !canApproveArticle() || status !== "ready_for_review" || !validation.ok || !translationGate.allReady;

  const syncBtn = qs("btn-send-main-site");
  if (syncBtn) {
    syncBtn.disabled = state.busy || locked || !canSyncArticle() || status !== "ready_for_sync" || !validation.ok || !translationGate.allReady;
    syncBtn.title = alreadySubmitted ? "รายการนี้ถูกส่งเข้า Admin Review แล้ว" : "";
  }

  const readinessBtn = qs("btn-refresh-readiness");
  if (readinessBtn) readinessBtn.disabled = state.busy || !canSyncArticle();

  const generateTranslationsBtn = qs("btn-generate-translations");
  if (generateTranslationsBtn) generateTranslationsBtn.disabled = state.busy || locked || !canManageTranslations();
}

function applyStaticCopy() {
  const headerTitle = document.querySelector(".header h1");
  if (headerTitle) headerTitle.textContent = "Review Event ก่อนส่งต่อ";
  const headerHelp = document.querySelector(".header .auth-row p");
  if (headerHelp) headerHelp.textContent = "ตรวจความพร้อมของ event และ self-check ก่อนส่งเข้า Admin Review";
  const backHomeBtn = qs("btn-back-home");
  if (backHomeBtn) backHomeBtn.textContent = "Home";
  const openIntakeBtn = qs("btn-open-intake");
  if (openIntakeBtn) openIntakeBtn.textContent = "กลับหน้าแรก";
  const openWorkspaceBtn = qs("btn-open-workspace");
  if (openWorkspaceBtn) openWorkspaceBtn.textContent = "กลับหน้าเขียน";
}

function hasBrokenCopy(text) {
  const value = String(text || "");
  return value.includes("?") || value.includes("\u00c3") || value.includes("\u00e0");
}

function repairVisibleCopy() {
  const status = getArticleStatus();
  const alreadySubmitted = status === "submitted_for_admin_review";
  const headerTitle = document.querySelector(".header h1");
  if (headerTitle) headerTitle.textContent = "Review Event \u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e15\u0e48\u0e2d";

  const headerHelp = document.querySelector(".header .auth-row p");
  if (headerHelp) headerHelp.textContent = "\u0e15\u0e23\u0e27\u0e08\u0e04\u0e27\u0e32\u0e21\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e02\u0e2d\u0e07 event \u0e41\u0e25\u0e30 self-check \u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Admin Review";

  const backHomeBtn = qs("btn-back-home");
  if (backHomeBtn) backHomeBtn.textContent = "\u0e01\u0e25\u0e31\u0e1a";
  const openIntakeBtn = qs("btn-open-intake");
  if (openIntakeBtn) openIntakeBtn.textContent = "\u0e01\u0e25\u0e31\u0e1a\u0e2b\u0e19\u0e49\u0e32\u0e41\u0e23\u0e01";
  const openWorkspaceBtn = qs("btn-open-workspace");
  if (openWorkspaceBtn) openWorkspaceBtn.textContent = "\u0e01\u0e25\u0e31\u0e1a\u0e2b\u0e19\u0e49\u0e32\u0e40\u0e02\u0e35\u0e22\u0e19";

  const reviewDescription = document.querySelector(".article-card-review > .article-section-head .muted");
  if (reviewDescription) reviewDescription.textContent = "\u0e15\u0e23\u0e27\u0e08\u0e04\u0e27\u0e32\u0e21\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e02\u0e2d\u0e07 Event \u0e01\u0e48\u0e2d\u0e19\u0e2d\u0e19\u0e38\u0e21\u0e31\u0e15\u0e34\u0e41\u0e25\u0e30\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Admin Review";
  const approveBtn = qs("btn-approve-sync");
  if (approveBtn) approveBtn.textContent = "\u0e2d\u0e19\u0e38\u0e21\u0e31\u0e15\u0e34\u0e41\u0e25\u0e30\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Admin Review";
  const syncDescription = document.querySelector(".article-review-sync-controls .article-section-head .muted");
  if (syncDescription) syncDescription.textContent = alreadySubmitted
    ? "\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e19\u0e35\u0e49\u0e16\u0e39\u0e01\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Admin Review \u0e41\u0e25\u0e49\u0e27"
    : "\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e19\u0e35\u0e49\u0e08\u0e30\u0e16\u0e39\u0e01\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Admin Review";
  const syncBtn = qs("btn-send-main-site");
  if (syncBtn) syncBtn.textContent = alreadySubmitted
    ? "\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Admin Review \u0e41\u0e25\u0e49\u0e27"
    : "\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Admin Review";

  const translationGenerateState = qs("translation-generate-state");
  if (translationGenerateState && hasBrokenCopy(translationGenerateState.textContent)) {
    translationGenerateState.textContent = "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e2a\u0e23\u0e49\u0e32\u0e07\u0e04\u0e33\u0e41\u0e1b\u0e25...";
  }

  const checklistRoot = qs("review-checklist");
  if (checklistRoot) {
    const labels = checklistRoot.querySelectorAll(".article-check-item span");
    const replacements = ["\u0e0a\u0e37\u0e48\u0e2d Event", "\u0e2a\u0e23\u0e38\u0e1b\u0e22\u0e48\u0e2d", "Slug", "Meta Title", "Meta Description", "Event Period", "Location", "\u0e40\u0e19\u0e37\u0e49\u0e2d\u0e2b\u0e32", "\u0e20\u0e32\u0e1e\u0e1b\u0e01"];
    labels.forEach((node, index) => {
      if (replacements[index]) node.textContent = replacements[index];
    });
  }

  const syncSummaryRoot = qs("sync-summary");
  if (syncSummaryRoot) {
    const labels = syncSummaryRoot.querySelectorAll(".summary-row strong");
    const values = syncSummaryRoot.querySelectorAll(".summary-row span");
    if (labels[0]) labels[0].textContent = "\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e01\u0e32\u0e23\u0e2a\u0e48\u0e07\u0e15\u0e48\u0e2d";
    if (labels[1]) labels[1].textContent = "\u0e04\u0e27\u0e32\u0e21\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e02\u0e2d\u0e07\u0e15\u0e49\u0e19\u0e09\u0e1a\u0e31\u0e1a";
    if (values[0]) values[0].textContent = getArticleStatus() === "synced_to_admin"
      ? "\u0e40\u0e1c\u0e22\u0e41\u0e1e\u0e23\u0e48\u0e41\u0e25\u0e49\u0e27\u0e1a\u0e19\u0e40\u0e27\u0e47\u0e1a\u0e2b\u0e25\u0e31\u0e01"
      : getArticleStatus() === "submitted_for_admin_review"
        ? "\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Admin Review \u0e41\u0e25\u0e49\u0e27"
      : getArticleStatus() === "ready_for_sync"
        ? "\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Admin Review"
        : "\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49\u0e1b\u0e23\u0e30\u0e40\u0e21\u0e34\u0e19\u0e04\u0e27\u0e32\u0e21\u0e1e\u0e23\u0e49\u0e2d\u0e21";
    if (values[1]) values[1].textContent = state.readiness?.source_ready
      ? "\u0e1e\u0e23\u0e49\u0e2d\u0e21"
      : getArticleStatus() === "synced_to_admin"
        ? "\u0e40\u0e1c\u0e22\u0e41\u0e1e\u0e23\u0e48\u0e41\u0e25\u0e49\u0e27"
      : (getArticleStatus() === "ready_for_sync" || getArticleStatus() === "submitted_for_admin_review")
        ? "\u0e1e\u0e23\u0e49\u0e2d\u0e21\u0e2a\u0e48\u0e07\u0e15\u0e48\u0e2d"
        : "\u0e23\u0e2d\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e2d\u0e1a";
    const muted = syncSummaryRoot.querySelector(".muted");
    if (muted && hasBrokenCopy(muted.textContent)) muted.textContent = "\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1b\u0e31\u0e0d\u0e2b\u0e32\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e40\u0e15\u0e34\u0e21";
    if (isCollectorLockedAfterAdminReview()) {
      const notice = document.createElement("p");
      notice.className = "warn";
      notice.textContent = "\u0e2a\u0e48\u0e07\u0e40\u0e02\u0e49\u0e32 Admin Review \u0e41\u0e25\u0e49\u0e27 - \u0e23\u0e2d\u0e01\u0e32\u0e23\u0e08\u0e31\u0e14\u0e01\u0e32\u0e23\u0e15\u0e48\u0e2d\u0e43\u0e19 Admin Panel";
      syncSummaryRoot.appendChild(notice);
    }
  }

  const translationStatus = qs("translation-status");
  if (translationStatus && hasBrokenCopy(translationStatus.textContent)) {
    translationStatus.textContent = state.busy
      ? "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e42\u0e2b\u0e25\u0e14\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e04\u0e33\u0e41\u0e1b\u0e25..."
      : "\u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e04\u0e33\u0e41\u0e1b\u0e25\u0e41\u0e25\u0e49\u0e27";
  }

  const translationSummaryRoot = qs("translation-summary");
  if (translationSummaryRoot) {
    const headLabels = translationSummaryRoot.querySelectorAll(".summary-row strong");
    if (headLabels[0]) headLabels[0].textContent = "\u0e2a\u0e16\u0e32\u0e19\u0e30";
    if (headLabels[1]) headLabels[1].textContent = "\u0e20\u0e32\u0e29\u0e32\u0e17\u0e35\u0e48\u0e23\u0e2d";
    const muted = translationSummaryRoot.querySelector(".muted");
    if (muted && hasBrokenCopy(muted.textContent)) {
      muted.textContent = getTranslationGateState().rows.length
        ? "\u0e15\u0e49\u0e2d\u0e07\u0e43\u0e2b\u0e49\u0e17\u0e38\u0e01\u0e20\u0e32\u0e29\u0e30\u0e2d\u0e22\u0e39\u0e48\u0e2a\u0e16\u0e32\u0e19\u0e30 passed \u0e01\u0e48\u0e2d\u0e19\u0e2d\u0e19\u0e38\u0e21\u0e31\u0e15\u0e34"
        : "\u0e2a\u0e23\u0e49\u0e32\u0e07\u0e04\u0e33\u0e41\u0e1b\u0e25\u0e01\u0e48\u0e2d\u0e19\u0e41\u0e25\u0e49\u0e27\u0e04\u0e48\u0e2d\u0e22\u0e15\u0e23\u0e27\u0e08\u0e04\u0e27\u0e32\u0e21\u0e1e\u0e23\u0e49\u0e2d\u0e21";
    }
  }

  const translationReviewSummaryRoot = qs("translation-review-summary");
  if (translationReviewSummaryRoot) {
    const headStrong = translationReviewSummaryRoot.querySelector(".article-translation-review-head strong");
    if (headStrong) headStrong.textContent = "\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e04\u0e33\u0e41\u0e1b\u0e25";
    const muted = translationReviewSummaryRoot.querySelector(".muted");
    if (muted && hasBrokenCopy(muted.textContent)) muted.textContent = "\u0e15\u0e23\u0e27\u0e08\u0e04\u0e33\u0e41\u0e1b\u0e25\u0e43\u0e2b\u0e49\u0e04\u0e23\u0e1a\u0e01\u0e48\u0e2d\u0e19\u0e2a\u0e48\u0e07\u0e15\u0e48\u0e2d";
  }

  const translationDetailTitle = qs("translation-detail-title");
  if (translationDetailTitle && hasBrokenCopy(translationDetailTitle.textContent)) {
    const currentLang = translationDetailTitle.textContent.split(":").pop()?.trim() || "-";
    translationDetailTitle.textContent = `\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14\u0e04\u0e33\u0e41\u0e1b\u0e25: ${currentLang}`;
  }

  const translationDetailBody = qs("translation-detail-body");
  if (translationDetailBody) {
    const labels = translationDetailBody.querySelectorAll(".translation-detail-item strong");
    const replacements = ["\u0e20\u0e32\u0e29\u0e32", "\u0e2a\u0e16\u0e32\u0e19\u0e30", "translation_status", "automatic_check", "\u0e40\u0e27\u0e25\u0e32\u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15", "\u0e1b\u0e31\u0e0d\u0e2b\u0e32"];
    labels.forEach((node, index) => {
      if (replacements[index]) node.textContent = replacements[index];
    });
    const muted = translationDetailBody.querySelector(".muted");
    if (muted && hasBrokenCopy(muted.textContent)) muted.textContent = "\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1b\u0e31\u0e0d\u0e2b\u0e32\u0e04\u0e33\u0e41\u0e1b\u0e25\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e40\u0e15\u0e34\u0e21";
  }
}

function renderAll(options = {}) {
  if (options.clearBanner === true) {
    setBanner("");
  }
  applyStaticCopy();
  if (options.syncFields === true) {
    renderReviewFields();
  }
  normalizeReviewActionCopy();
  renderProcessBar();
  renderAuthStatus();
  renderActivityLog();
  renderReviewChecklist();
  renderSyncSummary();
  renderTranslationSummary();
  renderTranslationReviewSummary();
  repairVisibleCopy();
  applyActionGuards();
}

async function refreshArticleProcess() {
  state.articleProcess = await api(`/api/items/${state.itemId}/article-process`);
}

async function transitionArticle(status, note = "") {
  if (isCollectorLockedAfterAdminReview()) throw new Error(lockedCollectorWorkflowMessage());
  setBusy(true);
  setBanner("กำลังอัปเดตสถานะรีวิว...", "loading");
  try {
    await api(`/api/items/${state.itemId}/article-process/transition`, {
      method: "POST",
      body: JSON.stringify({ status, note }),
    });
    await refreshArticleProcess();
    renderAll();
    setBanner("อัปเดตสถานะรีวิวแล้ว");
  } finally {
    setBusy(false);
    applyActionGuards();
  }
}

async function requestEditorialRevision(note = "") {
  if (isCollectorLockedAfterAdminReview()) throw new Error(lockedCollectorWorkflowMessage());
  const assignment = preferredRevisionAssignment();
  const assignmentId = Number(assignment?.id || 0) || 0;
  if (!assignmentId) {
    await transitionArticle("revision_requested", note);
    return;
  }
  const result = await api(`/api/items/${state.itemId}/article-editorial-assignments/${assignmentId}/request-revision`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
  state.articleProcess = result?.article_process || state.articleProcess;
  renderAll();
}

async function refreshReadiness() {
  setInlineStatus("review-status", "กำลังตรวจความพร้อมล่าสุด...", "loading");
  const result = await api(`/api/items/${state.itemId}/recheck-export-readiness`, { method: "POST" });
  state.readiness = result?.readiness || null;
  renderSyncSummary();
  renderTranslationSummary();
  renderTranslationReviewSummary();
  renderReviewChecklist();
  setInlineStatus("review-status", "ตรวจความพร้อมล่าสุดแล้ว");
}

async function refreshTranslations() {
  await loadTranslations();
  const liveRows = buildRepoTranslationStatusRows().map((row) => ({ lang: row.lang, status: row.status }));
  if (state.readiness) {
    const mergedRows = mergeTranslationReadinessRows(state.readiness?.translations, liveRows);
    state.readiness = {
      ...state.readiness,
      translations: mergedRows,
      translation_counts: translationSummaryCounts(mergedRows),
    };
  }
  renderTranslationSummary();
  renderTranslationReviewSummary();
  renderReviewChecklist();
  applyActionGuards();
}

async function generateTranslations() {
  if (isCollectorLockedAfterAdminReview()) throw new Error(lockedTranslationMessage());
  setTranslationGenerateLoading(true);
  setBusy(true);
  setInlineStatus("translation-status", "กำลังสร้างและตรวจคำแปล...", "loading");
  try {
    const result = await api(`/api/items/${state.itemId}/generate-translations`, { method: "POST" });
    const generatedCount = Number(result?.generated_count || result?.result?.translation_run?.generated_count || 0) || 0;
    const failedCount = Number(result?.failed_count || result?.result?.translation_run?.failed_count || 0) || 0;
    const failureSummary = summarizeTranslationFailures(result?.per_language_status || result?.result?.languages || []);
    state.readiness = result?.readiness || state.readiness;
    await refreshTranslations();
    renderSyncSummary();
    if (generatedCount > 0 && failedCount > 0) {
      setInlineStatus("translation-status", `สร้างคำแปลแล้ว ${generatedCount} ภาษา และมีปัญหา ${failedCount} ภาษา${failureSummary ? `: ${failureSummary}` : ""}`);
      return;
    }
    if (generatedCount > 0) {
      setInlineStatus("translation-status", `สร้างคำแปลแล้ว ${generatedCount} ภาษา`);
      return;
    }
    if (failedCount > 0) {
      setInlineStatus("translation-status", `ยังสร้างคำแปลไม่สำเร็จ (${failedCount} ภาษา)${failureSummary ? `: ${failureSummary}` : ""}`, "error");
      return;
    }
    setInlineStatus("translation-status", "ไม่มีภาษาที่ต้องสร้างเพิ่ม");
  } finally {
    setTranslationGenerateLoading(false);
    setBusy(false);
    applyActionGuards();
  }
}

async function sendToMainSite() {
  if (isCollectorLockedAfterAdminReview()) throw new Error(lockedCollectorWorkflowMessage());
  setBusy(true);
  setBanner("กำลังส่งเข้า Admin Review...", "loading");
  setInlineStatus("sync-status", "กำลังส่งเข้า Admin Review...", "loading");
  setInlineStatus("review-status", "กำลังส่งเข้า Admin Review...", "loading");
  try {
    const result = await api(`/api/items/${state.itemId}/submit-admin-review`, { method: "POST" });
    state.item = result?.item || state.item;
    state.articleProcess = result?.article_process || state.articleProcess;
    state.readiness = result?.readiness || state.readiness;
    await refreshArticleProcess();
    await loadTranslations();
    renderAll();
    setBanner("ส่งเข้า Admin Review แล้ว");
    setInlineStatus("sync-status", "ส่งเข้า Admin Review แล้ว");
    setInlineStatus("review-status", "ส่งเข้า Admin Review แล้ว");
  } finally {
    setBusy(false);
    applyActionGuards();
  }
}

function wire() {
  applyStaticCopy();
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-intake")?.addEventListener("click", () => {
    window.location.href = eventFallbackUrl();
  });
  qs("btn-open-workspace")?.addEventListener("click", () => {
    if (isCollectorLockedAfterAdminReview()) {
      setBanner("ส่งเข้า Admin Review แล้ว - เปิดดูได้แบบ read-only เท่านั้น", "error");
      return;
    }
    window.location.href = eventWorkspaceUrl();
  });
  qs("btn-open-review-preview")?.addEventListener("click", () => {
    if (state.token && typeof localStorage !== "undefined") {
      localStorage.setItem("collector_token", state.token);
    }
    window.open(eventReviewPreviewUrl(), "_blank", "noopener");
  });
  qs("btn-request-revision")?.addEventListener("click", async () => {
    try {
      if (isCollectorLockedAfterAdminReview()) throw new Error(lockedCollectorWorkflowMessage());
      await requestEditorialRevision(currentReviewNote() || "กรุณาทบทวนและแก้ไข event ตามข้อเสนอแนะ");
      window.location.href = eventFallbackUrl();
      setInlineStatus("review-status", "ส่งกลับเพื่อแก้ไขแล้ว");
    } catch (err) {
      setInlineStatus("review-status", err.message, "error");
    }
  });
  qs("btn-approve-sync")?.addEventListener("click", async () => {
    try {
      if (isCollectorLockedAfterAdminReview()) throw new Error(lockedCollectorWorkflowMessage());
      const validation = validateEventWorkspace();
      if (!validation.ok) throw new Error(`Missing: ${validation.missing.join(", ")}`);
      const translationGate = getTranslationGateState();
      if (!translationGate.allReady) throw new Error("คำแปลยังไม่พร้อม");
      setInlineStatus("review-status", "กำลังอนุมัติและส่งเข้า Admin Review...", "loading");
      await transitionArticle("ready_for_sync", currentReviewNote() || "อนุมัติ event และส่งเข้า Admin Review");
      await sendToMainSite();
      setInlineStatus("review-status", "อนุมัติแล้ว และส่งเข้า Admin Review แล้ว");
    } catch (err) {
      setInlineStatus("review-status", err.message, "error");
    }
  });
  qs("btn-refresh-readiness")?.addEventListener("click", async () => {
    try {
      await refreshReadiness();
    } catch (err) {
      setInlineStatus("review-status", err.message, "error");
    }
  });
    qs("btn-send-main-site")?.addEventListener("click", async () => {
      try {
        if (isCollectorLockedAfterAdminReview()) throw new Error(lockedCollectorWorkflowMessage());
        await sendToMainSite();
      } catch (err) {
        setInlineStatus("sync-status", err.message, "error");
        setInlineStatus("review-status", err.message, "error");
        setBanner(err.message, "error");
      }
    });
  qs("btn-generate-translations")?.addEventListener("click", async () => {
    try {
      if (isCollectorLockedAfterAdminReview()) throw new Error(lockedTranslationMessage());
      await generateTranslations();
    } catch (err) {
      setInlineStatus("translation-status", err.message, "error");
    }
  });
  const openTranslationDetailHandler = (event) => {
    const row = event.target.closest("[data-translation-detail]");
    if (!row) return;
    openTranslationDetail(row.dataset.translationDetail);
  };
  const openTranslationDetailKeyHandler = (event) => {
    const row = event.target.closest("[data-translation-detail]");
    if (!row || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openTranslationDetail(row.dataset.translationDetail);
  };
  qs("translation-summary")?.addEventListener("click", openTranslationDetailHandler);
  qs("translation-summary")?.addEventListener("keydown", openTranslationDetailKeyHandler);
  qs("translation-review-summary")?.addEventListener("click", openTranslationDetailHandler);
  qs("translation-review-summary")?.addEventListener("keydown", openTranslationDetailKeyHandler);
  qs("btn-close-translation-detail")?.addEventListener("click", closeTranslationDetail);
  qs("translation-detail-modal")?.addEventListener("click", (event) => {
    if (event.target?.id === "translation-detail-modal") closeTranslationDetail();
  });
}

async function init() {
  wire();
  if (currentRole() === "editor") {
    window.location.replace(eventWorkspaceUrl(state.itemId));
    return;
  }
  try {
    await loadWorkspace();
    if (!ensureEventItem()) return;
    if (!canApproveArticle()) {
      window.location.replace(eventFallbackUrl());
      return;
    }
    renderAll({ syncFields: true, clearBanner: true });
  } catch (err) {
    const role = currentRole();
    if (/forbidden/i.test(String(err?.message || "")) || role === "editor" || role === "freelance") {
      window.location.replace(eventFallbackUrl());
      return;
    }
    setBanner(err.message, "error");
  }
}

init();




