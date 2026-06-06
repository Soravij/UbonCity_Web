import {
  api,
  canApproveArticle,
  canManageTranslations,
  canSyncArticle,
  collectWorkspacePayload,
  currentOtherTransportMeta,
  currentReviewNote,
  currentRole,
  escapeHtml,
  formatDateTime,
  getArticleStatus,
  articleStatusLabel,
  latestDraft,
  loadTranslations,
  loadWorkspace,
  otherTransportSubtypeLabel,
  primaryAssignment,
  qs,
  reviewPreviewUrl,
  renderActivityLog,
  renderAuthStatus,
  renderProcessBar,
  reviewUrl,
  roleArticleFallbackUrl,
  sanitizeUrl,
  setBanner,
  setInlineStatus,
  isOtherTransportItem,
  state,
  validateWorkspace,
  workspaceUrl,
} from "./article-workflow-core.js";

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
  const isOtherTransport = isOtherTransportItem();
  const reviewDescription = document.querySelector(".article-card-review > .article-section-head .muted");
  if (reviewDescription) {
    reviewDescription.textContent = isOtherTransport
      ? "Source content is approved. Finalize translation quality and send the transport item onward."
      : "Source content is approved. Finalize translation quality and submit this article onward.";
  }

  const approveBtn = qs("btn-approve-sync");
  if (approveBtn) {
    approveBtn.textContent = isOtherTransport ? "พร้อมส่งขั้นสุดท้าย" : "พร้อมส่งขั้นสุดท้าย";
  }

  const syncTitle = document.querySelector(".article-review-sync-controls .section-title");
  if (syncTitle) {
    syncTitle.textContent = "Submit to Admin Review";
  }

  const syncDescription = document.querySelector(".article-review-sync-controls .article-section-head .muted");
  if (syncDescription) {
    syncDescription.textContent = "Send is blocked until every required locale passes translation recheck.";
  }

  const syncBtn = qs("btn-send-main-site");
  if (syncBtn) {
    syncBtn.textContent = "ส่งเข้า Admin Review";
  }
}

function renderReviewFields() {
  const noteNode = qs("review-note");
  if (noteNode) {
    noteNode.value = String(state.articleProcess?.workflow_model?.last_transition_note || "");
  }
}

function renderReviewArticleSummary() {
  const root = qs("article-review-summary");
  if (!root) return;
  const payload = collectWorkspacePayload();
  const item = state.item || {};
  const draft = latestDraft();
  const publishableSource = state.articleProcess?.publishable_source || null;
  const otherTransportMeta = currentOtherTransportMeta();
  const latestStatus = articleStatusLabel(getArticleStatus());
  root.innerHTML = `
    <div class="summary-row"><strong>ชื่อบทความ</strong><span>${escapeHtml(payload.item.title || "(ยังไม่มีชื่อ)")}</span></div>
    <div class="summary-row"><strong>สรุปย่อ</strong><span>${escapeHtml(payload.item.summary || "-")}</span></div>
    <div class="summary-row"><strong>Slug</strong><span>${escapeHtml(payload.item.slug || "-")}</span></div>
    <div class="summary-row"><strong>Meta Title</strong><span>${escapeHtml(payload.item.meta_title || "-")}</span></div>
    <div class="summary-row"><strong>Meta Description</strong><span>${escapeHtml(payload.item.meta_description || "-")}</span></div>
    ${isOtherTransportItem() ? `<div class="summary-row"><strong>ประเภทขนส่ง</strong><span>${escapeHtml(otherTransportSubtypeLabel(otherTransportMeta.subtype))}</span></div>` : ""}
    ${publishableSource ? `<div class="summary-row"><strong>Publishable source</strong><span>${escapeHtml(`assignment #${Number(publishableSource.assignment_id || 0) || "-"} / submission #${Number(publishableSource.latest_submission_id || 0) || "-"}`)}</span></div>` : ""}
    <div class="summary-row"><strong>สถานะล่าสุด</strong><span>${escapeHtml(draft?.status || latestStatus || "-")}</span></div>
  `;
}

function renderReviewChecklist() {
  const root = qs("review-checklist");
  if (!root) return;
  const payload = collectWorkspacePayload();
  const body = String(payload.item.description_clean || "").trim();
  const hasCover = (Array.isArray(state.assets) ? state.assets : []).some((row) => Number(row.is_cover || 0) === 1 || String(row.role || "") === "cover");
  const translationGate = getTranslationGateState();
  const translationRecheckGate = getTranslationRecheckGateState();
  const otherTransportMeta = currentOtherTransportMeta();
  const checks = [
    { label: "มีชื่อบทความ", pass: Boolean(payload.item.title) },
    { label: "มีสรุปย่อ", pass: Boolean(payload.item.summary) },
    { label: "มี Slug", pass: Boolean(payload.item.slug) },
    { label: "มี Meta Title", pass: Boolean(payload.item.meta_title) },
    { label: "มี Meta Description", pass: Boolean(payload.item.meta_description) },
    { label: "มีเนื้อหา", pass: Boolean(body) },
    { label: "มีรูปปก", pass: hasCover },
    { label: "ภาษาครบตามเกณฑ์", pass: translationGate.allReady },
    { label: "Translation recheck ผ่านทุกภาษา", pass: translationRecheckGate.allReady },
  ];
  if (isOtherTransportItem()) {
    checks.push(
      { label: "มีประเภท transport", pass: Boolean(otherTransportMeta.subtype) },
      { label: "มีชื่อผู้ติดต่อ", pass: Boolean(otherTransportMeta.contact_name) },
      { label: "มีช่องทางติดต่อ", pass: Boolean(otherTransportMeta.phone || otherTransportMeta.contact_details || otherTransportMeta.link_url) },
      { label: "thumbnail ใช้ cover image", pass: hasCover },
    );
  }
  root.innerHTML = checks.map((row) => `
    <label class="article-check-item">
      <input type="checkbox" disabled ${row.pass ? "checked" : ""} />
      <span>${escapeHtml(row.label)}</span>
    </label>
  `).join("");
}

function renderOtherTransportSummary() {
  const card = qs("other-transport-review-card");
  const root = qs("other-transport-review-summary");
  if (!card || !root) return;
  const enabled = isOtherTransportItem();
  card.classList.toggle("hidden", !enabled);
  if (!enabled) return;

  const meta = currentOtherTransportMeta();
  const cover = (Array.isArray(state.assets) ? state.assets : []).find((row) => Number(row.is_cover || 0) === 1 || String(row.role || "").trim().toLowerCase() === "cover") || null;
  const coverUrl = sanitizeUrl(cover?.public_url || "");
  root.innerHTML = `
    <div class="summary-row"><strong>ประเภท</strong><span>${escapeHtml(otherTransportSubtypeLabel(meta.subtype))}</span></div>
    <div class="summary-row"><strong>ผู้ติดต่อ</strong><span>${escapeHtml(meta.contact_name || "-")}</span></div>
    <div class="summary-row"><strong>เบอร์โทร</strong><span>${escapeHtml(meta.phone || "-")}</span></div>
    <div class="summary-row"><strong>ลิงก์</strong><span>${meta.link_url ? `<a href="${escapeHtml(meta.link_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(meta.link_url)}</a>` : "-"}</span></div>
    <div class="summary-row"><strong>ช่องทางติดต่อ</strong><span>${escapeHtml(meta.contact_details || "-")}</span></div>
    <div class="summary-row"><strong>Thumbnail</strong><span>${escapeHtml(cover ? (cover.file_name || "cover asset") : "ยังไม่มี cover image")}</span></div>
    ${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="other transport thumbnail" style="max-width:220px;border-radius:12px;display:block;margin-top:12px;" />` : ""}
  `;
}

function renderSyncSummary() {
  const root = qs("sync-summary");
  if (!root) return;
  const readiness = state.readiness || null;
  const status = getArticleStatus();
  root.classList.remove("hidden");
  if (!readiness) {
    root.innerHTML = `
      <div class="summary-row"><strong>Source article</strong><span class="ok">approved</span></div>
      <div class="summary-row"><strong>Workflow status</strong><span>${escapeHtml(status === "synced_to_admin" ? "sent to main site" : status === "submitted_for_admin_review" ? "submitted to admin review" : "preparing translation workflow")}</span></div>
      `;
    return;
  }
  const usesFieldFlow = Boolean(readiness?.field_flow_ready) || Boolean(state.articleProcess?.publishable_source_ready);
  const issues = usesFieldFlow
    ? (Array.isArray(readiness.field_flow_issues) ? readiness.field_flow_issues : [])
    : (Array.isArray(readiness.source_issues) ? readiness.source_issues : []);
  const approvalLabel = status === "synced_to_admin"
    ? "เผยแพร่แล้วบนเว็บหลัก"
    : status === "submitted_for_admin_review"
      ? "ส่งเข้า Admin Review แล้ว"
    : status === "ready_for_sync"
      ? "อนุมัติแล้ว รอเผยแพร่"
      : usesFieldFlow && status === "ready_for_review"
        ? "มีเนื้อหาจาก submission พร้อมอนุมัติ"
        : "อยู่ระหว่างตรวจงาน";
  root.innerHTML = `
    <div class="summary-row"><strong>Source article</strong><span class="ok">approved</span></div>
    <div class="summary-row"><strong>Package source</strong><span class="${readiness.source_ready ? "ok" : "fail"}">${readiness.source_ready ? "ready for translation workflow" : "source package incomplete"}</span></div>
    <div class="summary-row"><strong>Workflow status</strong><span>${escapeHtml(approvalLabel)}</span></div>
    ${issues.length ? `<ul>${issues.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>` : '<p class="muted">ไม่มีประเด็นค้าง</p>'}
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

function translationRecheckStatusCounts(rows) {
  const counts = { passed: 0, warning: 0, failed: 0, stale: 0, not_checked: 0, total: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const status = String(row?.translation_recheck_status || "").trim().toLowerCase() || "not_checked";
    if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    counts.total += 1;
  }
  return counts;
}

function currentSourceFingerprint() {
  return String(state.readiness?.current_source_fingerprint || "").trim();
}

function hasLiveReadiness() {
  return Boolean(state.readiness && Array.isArray(state.readiness.translations));
}

function hasSourceFingerprintMismatch(row, expectedFingerprint = currentSourceFingerprint()) {
  const currentFingerprint = String(expectedFingerprint || "").trim();
  if (!currentFingerprint) return false;
  return String(row?.source_fingerprint || "").trim() !== currentFingerprint;
}

function isTranslationRowStale(row, expectedFingerprint = currentSourceFingerprint()) {
  return hasSourceFingerprintMismatch(row, expectedFingerprint)
    || Number(row?.stale_flag || 0) === 1
    || String(row?.status || "").trim().toLowerCase() === "stale"
    || String(row?.translation_status || "").trim().toLowerCase() === "stale";
}

function localeLabel(lang) {
  const normalized = String(lang || "").trim().toLowerCase();
  if (normalized === "th") return "TH / Thai";
  if (normalized === "en") return "EN / English";
  if (normalized === "lo") return "LO / Lao";
  if (normalized === "zh") return "ZH / Chinese";
  return normalized ? normalized.toUpperCase() : "-";
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function parseRecheckIssues(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry && typeof entry === "object") {
        return String(entry.problem_th || entry.suggestion_th || entry.target_text || entry.source_text || "").trim();
      }
      return String(entry || "").trim();
    }).filter(Boolean);
  }
  if (!value) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parseRecheckIssues(parsed);
    } catch {
      return [];
    }
  }
  if (typeof value === "object") {
    if (Array.isArray(value.issues)) return parseRecheckIssues(value.issues);
    return Object.values(value).map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  return [];
}

function translationRecheckStatusFromRow(row) {
  if (isTranslationRowStale(row)) return "stale";
  const raw = String(row?.translation_recheck_status || "").trim().toLowerCase();
  if (["passed", "warning", "failed", "stale"].includes(raw)) return raw;
  return "not_checked";
}

function translationRecheckStatusLabel(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "passed") return "Passed";
  if (status === "warning") return "Warning";
  if (status === "failed") return "Failed";
  if (status === "stale") return "Stale";
  return "Not checked";
}

function getTranslationRecheckEligibility(row) {
  const translationStatus = String(row?.translation_status || "").trim().toLowerCase();
  const automaticCheckStatus = String(row?.automatic_check_status || "").trim().toLowerCase();
  const stale = isTranslationRowStale(row) || String(row?.translation_recheck_status || "").trim().toLowerCase() === "stale";
  if (stale) {
    return { eligible: false, reason: "Translation is stale" };
  }
  if (translationStatus !== "ready") {
    return { eligible: false, reason: "Translation is missing" };
  }
  if (automaticCheckStatus !== "passed") {
    return { eligible: false, reason: "Technical QA must pass first" };
  }
  return { eligible: true, reason: "" };
}

function isTranslationRecheckBusy(lang = "") {
  return String(state.translationRecheckBusyLang || "").trim().toLowerCase() === String(lang || "").trim().toLowerCase();
}

function validateRecheckResponseLocale(response, requestedLang) {
  const normalizedRequestedLang = String(requestedLang || "").trim().toLowerCase();
  const localeResults = Array.isArray(response?.result?.locales) ? response.result.locales : [];
  if (localeResults.length > 0) {
    const matchedLocale = localeResults.find((row) => String(row?.lang || "").trim().toLowerCase() === normalizedRequestedLang) || null;
    if (!matchedLocale) {
      return { ok: false, reason: "Recheck returned a different locale than requested", matchedLocale: null };
    }
    return { ok: true, reason: "", matchedLocale: normalizedRequestedLang };
  }

  const translation = response?.translation && typeof response.translation === "object"
    ? response.translation
    : null;
  if (translation) {
    const translationLang = String(translation?.lang || "").trim().toLowerCase();
    if (translationLang !== normalizedRequestedLang) {
      return { ok: false, reason: "Recheck returned a different locale than requested", matchedLocale: null };
    }
    return { ok: true, reason: "", matchedLocale: normalizedRequestedLang };
  }

  if (Array.isArray(response?.translations)) {
    return { ok: false, reason: "Recheck returned a different locale than requested", matchedLocale: null };
  }

  return { ok: false, reason: "Recheck response did not include the requested locale", matchedLocale: null };
}

function buildTranslationRecheckRows() {
  return buildTranslationRows().map((row) => {
    const live = (Array.isArray(state.translations) ? state.translations : []).find(
      (entry) => String(entry?.lang || "").trim().toLowerCase() === String(row?.lang || "").trim().toLowerCase(),
    ) || null;
    return {
      lang: String(row?.lang || "").trim().toLowerCase(),
      automatic_check_status: String(live?.automatic_check_status || row?.automatic_check_status || "").trim().toLowerCase() || "-",
      translation_status: String(live?.translation_status || row?.translation_status || "").trim().toLowerCase() || "-",
      translation_recheck_status: translationRecheckStatusFromRow({ ...row, ...live }),
      translation_recheck_score: normalizeScore(live?.translation_recheck_score),
      accuracy_score: normalizeScore(live?.accuracy_score),
      fluency_score: normalizeScore(live?.fluency_score),
      term_score: normalizeScore(live?.term_score),
      back_translation_th: String(live?.back_translation_th || "").trim(),
      recheck_summary_th: String(live?.recheck_summary_th || "").trim(),
      recheck_issues: parseRecheckIssues(live?.recheck_issues_json ?? live?.recheck_issues),
      rechecked_at: live?.rechecked_at || null,
      repair_attempt_count: Number(live?.repair_attempt_count || 0) || 0,
      stale_flag: Number(live?.stale_flag || 0) || 0,
      source_fingerprint: String(live?.source_fingerprint || "").trim(),
    };
  });
}

function getTranslationRecheckGateState() {
  const rows = buildTranslationRecheckRows();
  const counts = translationRecheckStatusCounts(rows);
  if (!hasLiveReadiness()) {
    const blockingLangs = rows.map((row) => String(row?.lang || "").trim().toUpperCase()).filter(Boolean);
    return {
      rows,
      counts,
      blockingRows: rows,
      blockingLangs,
      allReady: false,
    };
  }
  const blockingRows = rows.filter((row) => {
    const automaticPassed = String(row?.automatic_check_status || "").trim().toLowerCase() === "passed";
    const notStale = !isTranslationRowStale(row) && String(row?.translation_recheck_status || "") !== "stale";
    const recheckPassed = String(row?.translation_recheck_status || "").trim().toLowerCase() === "passed";
    return !(automaticPassed && notStale && recheckPassed);
  });
  return {
    rows,
    counts,
    blockingRows,
    blockingLangs: blockingRows.map((row) => String(row?.lang || "").trim().toUpperCase()).filter(Boolean),
    allReady: rows.length > 0 && blockingRows.length === 0,
  };
}

function translationStatusFromRepoRow(row) {
  if (isTranslationRowStale(row)) return "stale";
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

function translationSourceKindLabel(value) {
  const kind = String(value || "").trim().toLowerCase();
  if (kind === "published_article") return "published article";
  if (kind === "legacy_draft_review") return "legacy draft/review";
  if (kind === "assignment_publishable_source") return "assignment publishable source";
  return "-";
}

function buildRepoTranslationStatusRows() {
  return (Array.isArray(state.translations) ? state.translations : []).map((row) => ({
    lang: String(row?.lang || "").trim().toLowerCase(),
    status: translationStatusFromRepoRow(row),
    translation_status: String(row?.translation_status || "").trim().toLowerCase() || "-",
    automatic_check_status: String(row?.automatic_check_status || "").trim().toLowerCase() || "-",
    source_fingerprint: String(row?.source_fingerprint || "").trim(),
    source_kind: String(row?.source_kind || "").trim().toLowerCase() || "-",
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
      status: live && isTranslationRowStale(live)
        ? "stale"
        : String(row?.status || "not_ready").trim().toLowerCase(),
        translation_status: String(live?.translation_status || "").trim().toLowerCase() || "-",
        automatic_check_status: String(live?.automatic_check_status || "").trim().toLowerCase() || "-",
        source_kind: String(live?.source_kind || "").trim().toLowerCase() || "-",
        failure_reason: translationFailureReasonFromRow(live),
        issues: translationIssuesFromRow(live),
        updated_at: live?.updated_at || null,
      };
    });
  }

  return buildRepoTranslationStatusRows().map((row) => ({
    ...row,
    status: String(row?.status || "").trim().toLowerCase() === "stale" ? "stale" : "not_ready",
  }));
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
  title.textContent = `รายละเอียดภาษา: ${String(row.lang || "-").toUpperCase()}`;
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
        <strong>ผลแปล</strong>
        <span>${escapeHtml(String(row.translation_status || "-"))}</span>
      </div>
      <div class="translation-detail-item">
        <strong>ผลตรวจ</strong>
        <span>${escapeHtml(String(row.automatic_check_status || "-"))}</span>
      </div>
      <div class="translation-detail-item">
        <strong>Source</strong>
        <span>${escapeHtml(translationSourceKindLabel(row.source_kind))}</span>
      </div>
      <div class="translation-detail-item">
        <strong>Failure reason</strong>
        <span>${escapeHtml(String(row.failure_reason || "-"))}</span>
      </div>
      <div class="translation-detail-item full-span">
        <strong>อัปเดตล่าสุด</strong>
        <span>${escapeHtml(formatDateTime(row.updated_at))}</span>
      </div>
      <div class="translation-detail-item full-span">
        <strong>หมายเหตุ</strong>
        ${issues.length ? `<ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : '<p class="muted">ไม่มีรายละเอียดเพิ่มเติม</p>'}
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
  const statusNode = qs("translation-status");
  const hintNode = qs("translation-package-hint");
  const generateBtn = qs("btn-generate-translations");
  const actionNode = qs("translation-package-actions");
  if (!root) return;
  const gate = getTranslationGateState();
  const rows = gate.rows;
  root.classList.remove("hidden");

  if (!rows.length) {
    root.innerHTML = `
      <div class="summary-row"><strong>Package status</strong><span class="fail">missing</span></div>
      <div class="summary-row"><strong>Required locales</strong><span>0</span></div>
      <p class="muted">Create the first translation package for all required locales.</p>
    `;
    if (statusNode) {
      statusNode.textContent = "Create the first translation package for all required locales.";
    }
    if (hintNode) hintNode.textContent = "Create the first translation package for all required locales.";
    if (generateBtn) {
      generateBtn.classList.add("ok");
      generateBtn.classList.remove("utility-action");
      generateBtn.textContent = "Generate translations";
    }
    actionNode?.classList.remove("hidden");
    return;
  }

  const counts = gate.counts;
  const staleRows = rows.filter((row) => String(row?.status || "").trim().toLowerCase() === "stale");
  const missingRows = rows.filter((row) => String(row?.status || "").trim().toLowerCase() !== "passed" && String(row?.status || "").trim().toLowerCase() !== "stale");
  const staleCount = staleRows.length;
  const missingCount = missingRows.length;
  const packageComplete = staleCount === 0 && missingCount === 0;
  const packageLabel = packageComplete ? "complete" : staleCount > 0 ? "stale" : "missing";
  const requiredLocales = rows.map((row) => localeLabel(row.lang)).filter(Boolean).join(", ");
  const missingLocales = missingRows.map((row) => localeLabel(row.lang)).join(", ");
  const staleLocales = staleRows.map((row) => localeLabel(row.lang)).join(", ");

  if (statusNode) {
    statusNode.textContent = packageComplete
      ? "Translations are complete. Next step: check translation quality."
      : staleCount > 0
        ? "Source changed after translation. Regenerate stale translations."
        : "Create the first translation package for all required locales.";
  }
  if (hintNode) {
    hintNode.textContent = packageComplete
      ? ""
      : staleCount > 0
        ? "Source changed after translation. Regenerate stale translations."
        : "Create the first translation package for all required locales.";
  }
  if (generateBtn) {
    generateBtn.classList.toggle("ok", !packageComplete);
    generateBtn.classList.toggle("utility-action", packageComplete);
    generateBtn.textContent = staleCount > 0 ? "Regenerate translations" : "Generate translations";
  }
  actionNode?.classList.toggle("hidden", packageComplete);

  root.innerHTML = `
    <div class="summary-row"><strong>Package status</strong><span class="${packageComplete ? "ok" : staleCount > 0 ? "warn" : "fail"}">${escapeHtml(packageLabel)}</span></div>
    <div class="summary-row"><strong>Required locales</strong><span>${counts.total}</span></div>
    <div class="summary-row"><strong>Locale list</strong><span>${escapeHtml(requiredLocales || "-")}</span></div>
    ${missingCount ? `<div class="summary-row"><strong>Missing locales</strong><span>${escapeHtml(missingLocales)}</span></div>` : ""}
    ${staleCount ? `<div class="summary-row"><strong>Stale locales</strong><span>${escapeHtml(staleLocales)}</span></div>` : ""}
    <div class="article-translation-list">
      ${rows.map((row) => {
        const rowStatus = String(row?.status || "").trim().toLowerCase();
        const packageStatus = rowStatus === "passed" ? "translated" : rowStatus === "stale" ? "stale" : "missing";
        const packageStatusClass = rowStatus === "passed" ? "ok" : rowStatus === "stale" ? "warn" : "fail";
        return `
        <div class="article-translation-row" role="button" tabindex="0" data-translation-detail="${escapeHtml(String(row.lang || ""))}">
          <strong>${escapeHtml(localeLabel(row.lang))}</strong>
          <span class="${packageStatusClass}">${escapeHtml(packageStatus)}</span>
        </div>
      `;
      }).join("")}
    </div>
  `;
}
function renderTranslationReviewSummary() {
  const root = qs("translation-review-summary");
  if (!root) return;
  const translationGate = getTranslationGateState();
  const recheckGate = getTranslationRecheckGateState();
  const packageReady = translationGate.rows.length > 0 && translationGate.allReady;
  if (!recheckGate.rows.length) {
    root.innerHTML = `
      <div class="article-translation-review-head">
        <strong>Final send gate</strong>
        <span class="fail">blocked</span>
      </div>
      <div class="readiness-summary">
        <div class="summary-row"><strong>Translation Package</strong><span class="${packageReady ? "ok" : "fail"}">${packageReady ? "complete" : "not complete"}</span></div>
        <div class="summary-row"><strong>Translation Recheck</strong><span class="fail">not passed</span></div>
        <div class="summary-row"><strong>Final send</strong><span class="fail">blocked</span></div>
      </div>
      <p class="muted">Send is blocked until every required locale passes translation recheck.</p>
    `;
    return;
  }
  root.innerHTML = `
    <div class="article-translation-review-head">
      <strong>Final send gate</strong>
      <span class="${recheckGate.allReady ? "ok" : "fail"}">${recheckGate.allReady ? "ready to send" : `blocked: ${recheckGate.blockingLangs.join(", ")}`}</span>
    </div>
    <div class="readiness-summary">
      <div class="summary-row"><strong>Translation Package</strong><span class="${packageReady ? "ok" : "fail"}">${packageReady ? "complete" : "not complete"}</span></div>
      <div class="summary-row"><strong>Translation Recheck</strong><span class="${recheckGate.allReady ? "ok" : "fail"}">${recheckGate.allReady ? "passed" : "not passed"}</span></div>
      <div class="summary-row"><strong>Final send</strong><span class="${recheckGate.allReady ? "ok" : "fail"}">${recheckGate.allReady ? "ready" : "blocked"}</span></div>
    </div>
    <p class="muted">Send is blocked until every required locale passes translation recheck.</p>
  `;
}

function renderFinalSendSummary() {
  renderTranslationReviewSummary();
}

function renderTranslationRecheckPanel() {
  const root = qs("translation-recheck-panel");
  if (!root) return;
  const gate = getTranslationRecheckGateState();
  root.classList.remove("hidden");

  if (!gate.rows.length) {
    root.innerHTML = `
      <div class="translation-recheck-head">
        <div>
          <h3 class="section-title">3. Translation Recheck</h3>
          <p class="muted">Translation recheck has not run yet.</p>
        </div>
        <span class="fail">not ready</span>
      </div>
      <p class="muted">No translation rows found.</p>
    `;
    return;
  }

  const readinessText = gate.allReady
    ? "Ready: all required locales passed translation recheck."
    : `Not ready: ${gate.blockingLangs.join(", ") || "required locales"} need translation recheck.`;
  root.innerHTML = `
    <div class="translation-recheck-head">
      <div>
        <h3 class="section-title">3. Translation Recheck</h3>
        <p class="muted">This item cannot be sent to backend until all required locales pass translation recheck.</p>
      </div>
      <span class="${gate.allReady ? "ok" : "fail"}">${escapeHtml(gate.allReady ? "Ready" : "Not ready")}</span>
    </div>
    <p class="translation-recheck-summary-line ${gate.allReady ? "ok" : "fail"}">${escapeHtml(readinessText)}</p>
    <div class="translation-recheck-list">
      ${gate.rows.map((row) => {
        const hasFutureDetails = row.back_translation_th || row.recheck_summary_th || row.recheck_issues.length;
        const primaryScore = row.translation_recheck_score ?? row.accuracy_score ?? row.fluency_score ?? row.term_score;
        const statusLabel = translationRecheckStatusLabel(row.translation_recheck_status);
        const scoreLabel = primaryScore == null ? "-" : `${escapeHtml(String(primaryScore))}/10`;
        const recheckEligibility = getTranslationRecheckEligibility(row);
        const rowBusy = isTranslationRecheckBusy(row.lang);
        const recheckDisabled = state.busy || rowBusy || !canManageTranslations() || !recheckEligibility.eligible;
        const defaultActionHtml = row.translation_recheck_status === "passed"
          ? `<span class="translation-recheck-action-note">View technical details below</span>`
          : row.translation_recheck_status === "stale"
            ? `
              <button type="button" class="utility-action" disabled>Regenerate</button>
              <span class="translation-recheck-action-note">Translation is stale</span>
            `
            : row.translation_recheck_status === "failed" || row.translation_recheck_status === "warning"
              ? recheckEligibility.eligible
                ? `
                  <button type="button" class="utility-action" data-translation-recheck-lang="${escapeHtml(String(row.lang || ""))}" ${recheckDisabled ? "disabled" : ""}>Recheck again</button>
                  <button type="button" class="utility-action" disabled>Repair</button>
                  <button type="button" class="utility-action" disabled>Regenerate</button>
                `
                : `
                  <button type="button" class="utility-action" data-translation-recheck-lang="${escapeHtml(String(row.lang || ""))}" disabled>Recheck again</button>
                  <span class="translation-recheck-action-note">${escapeHtml(recheckEligibility.reason)}</span>
                  <button type="button" class="utility-action" disabled>Repair</button>
                  <button type="button" class="utility-action" disabled>Regenerate</button>
                `
              : `
                <button type="button" class="utility-action" data-translation-recheck-lang="${escapeHtml(String(row.lang || ""))}" ${recheckDisabled ? "disabled" : ""}>Recheck</button>
                ${recheckEligibility.reason ? `<span class="translation-recheck-action-note">${escapeHtml(recheckEligibility.reason)}</span>` : ""}
              `;
        return `
          <div class="translation-recheck-row">
            <div class="translation-recheck-row-head">
              <strong>${escapeHtml(localeLabel(row.lang))}</strong>
              <span class="${row.translation_recheck_status === "passed" ? "ok" : row.translation_recheck_status === "failed" ? "fail" : row.translation_recheck_status === "warning" || row.translation_recheck_status === "stale" ? "warn" : "muted"}">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="translation-recheck-meta">
              <span><strong>Status:</strong> ${escapeHtml(statusLabel)}</span>
              <span><strong>Score:</strong> ${scoreLabel}</span>
            </div>
            <div class="translation-recheck-default-action">${defaultActionHtml}</div>
            <details class="translation-recheck-future-actions">
              <summary>${escapeHtml(hasFutureDetails ? "Technical details" : "Technical details")}</summary>
              <div class="translation-recheck-meta">
                <span><strong>Technical QA:</strong> ${escapeHtml(row.automatic_check_status || "-")}</span>
                <span><strong>Accuracy:</strong> ${row.accuracy_score == null ? "-" : escapeHtml(String(row.accuracy_score))}</span>
                <span><strong>Fluency:</strong> ${row.fluency_score == null ? "-" : escapeHtml(String(row.fluency_score))}</span>
                <span><strong>Term consistency:</strong> ${row.term_score == null ? "-" : escapeHtml(String(row.term_score))}</span>
                <span><strong>Rechecked at:</strong> ${escapeHtml(formatDateTime(row.rechecked_at))}</span>
                <span><strong>Repair attempts:</strong> ${escapeHtml(String(row.repair_attempt_count || 0))}</span>
              </div>
              ${row.back_translation_th ? `<div class="translation-recheck-diagnostics"><strong>Back translation</strong><p>${escapeHtml(row.back_translation_th)}</p></div>` : ""}
              ${row.recheck_summary_th ? `<div class="translation-recheck-diagnostics"><strong>Issues</strong><p>${escapeHtml(row.recheck_summary_th)}</p></div>` : ""}
              ${row.recheck_issues.length ? `<div class="translation-recheck-diagnostics"><strong>Issue list</strong><ul>${row.recheck_issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul></div>` : ""}
            </details>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function applyActionGuards() {
  const status = getArticleStatus();
  const validation = validateWorkspace();
  const translationGate = getTranslationGateState();
  const translationRecheckGate = getTranslationRecheckGateState();

  const revisionBtn = qs("btn-request-revision");
  if (revisionBtn) revisionBtn.disabled = state.busy || !canApproveArticle() || !["ready_for_review", "ready_for_sync", "submitted_for_admin_review"].includes(status);

  const approveBtn = qs("btn-approve-sync");
  if (approveBtn) {
    approveBtn.disabled = state.busy
      || !canApproveArticle()
      || status !== "ready_for_review"
      || !validation.ok
      || !translationGate.allReady
      || !translationRecheckGate.allReady;
  }

  const syncBtn = qs("btn-send-main-site");
  if (syncBtn) {
    syncBtn.disabled = state.busy
      || !canSyncArticle()
      || status !== "ready_for_sync"
      || !translationGate.allReady
      || !translationRecheckGate.allReady;
  }

  const readinessBtn = qs("btn-refresh-readiness");
  if (readinessBtn) readinessBtn.disabled = state.busy || !canSyncArticle();

  const generateTranslationsBtn = qs("btn-generate-translations");
  if (generateTranslationsBtn) generateTranslationsBtn.disabled = state.busy || !canManageTranslations();
}

function renderAll(options = {}) {
  if (options.syncFields === true) {
    renderReviewFields();
  }
  normalizeReviewActionCopy();
  renderProcessBar();
  renderAuthStatus();
  renderActivityLog();
  renderReviewArticleSummary();
  renderReviewChecklist();
  renderOtherTransportSummary();
  renderSyncSummary();
  renderTranslationSummary();
  renderTranslationRecheckPanel();
  renderTranslationReviewSummary();
  applyActionGuards();
}

async function refreshArticleProcess() {
  state.articleProcess = await api(`/api/items/${state.itemId}/article-process`);
}

async function loadCurrentReadiness() {
  state.readiness = await api(`/api/items/${state.itemId}/export-readiness`);
  return state.readiness;
}

async function transitionArticle(status, note = "") {
  setBusy(true);
  setBanner("กำลังอัปเดตสถานะ...", "loading");
  try {
    await api(`/api/items/${state.itemId}/article-process/transition`, {
      method: "POST",
      body: JSON.stringify({ status, note }),
    });
    await refreshArticleProcess();
    renderAll();
    setBanner("อัปเดตสถานะแล้ว");
  } finally {
    setBusy(false);
    applyActionGuards();
  }
}

async function requestEditorialRevision(note = "") {
  const assignment = primaryAssignment();
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
  setInlineStatus("review-status", "กำลังตรวจความพร้อม...", "loading");
  const result = await api(`/api/items/${state.itemId}/recheck-export-readiness`, { method: "POST" });
  state.readiness = result?.readiness || null;
  renderSyncSummary();
  renderTranslationSummary();
  renderTranslationRecheckPanel();
  renderTranslationReviewSummary();
  renderReviewChecklist();
  setInlineStatus("review-status", "อัปเดตความพร้อมแล้ว");
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
  renderTranslationRecheckPanel();
  renderTranslationReviewSummary();
  renderReviewChecklist();
  applyActionGuards();
}

async function generateTranslations() {
  setTranslationGenerateLoading(true);
  setBusy(true);
  setInlineStatus("translation-status", "กำลังสร้างคำแปล...", "loading");
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

function applyImmediateTranslationRecheckResult(result, fallbackLang = "") {
  const translationsFromResponse = Array.isArray(result?.translations) ? result.translations : null;
  if (translationsFromResponse) {
    state.translations = translationsFromResponse;
    return;
  }

  const translationFromResponse = result?.translation && typeof result.translation === "object"
    ? result.translation
    : null;
  const localeResults = Array.isArray(result?.result?.locales) ? result.result.locales : [];
  const normalizedFallbackLang = String(fallbackLang || "").trim().toLowerCase();
  if (!translationFromResponse && !localeResults.length) return;

  const nextRows = Array.isArray(state.translations) ? [...state.translations] : [];
  const updateByLang = new Map(
    localeResults
      .map((row) => [String(row?.lang || "").trim().toLowerCase(), row])
      .filter(([lang]) => lang),
  );
  if (translationFromResponse) {
    const responseLang = String(translationFromResponse?.lang || normalizedFallbackLang).trim().toLowerCase();
    if (responseLang) updateByLang.set(responseLang, translationFromResponse);
  }

  for (const [lang, patch] of updateByLang.entries()) {
    const index = nextRows.findIndex((row) => String(row?.lang || "").trim().toLowerCase() === lang);
    if (index >= 0) {
      nextRows[index] = { ...nextRows[index], ...patch };
      continue;
    }
    nextRows.push({ lang, ...patch });
  }

  state.translations = nextRows;
}

async function runTranslationRecheck(lang) {
  const normalizedLang = String(lang || "").trim().toLowerCase();
  if (!normalizedLang || state.busy || state.translationRecheckBusyLang) return;
  setBusy(true);
  state.translationRecheckBusyLang = normalizedLang;
  renderTranslationRecheckPanel();
  applyActionGuards();
  setInlineStatus("review-status", `Running translation recheck for ${normalizedLang.toUpperCase()}...`, "loading");
  try {
    const result = await api(`/api/items/${state.itemId}/translations/${encodeURIComponent(normalizedLang)}/recheck`, {
      method: "POST",
    });
    const localeValidation = validateRecheckResponseLocale(result, normalizedLang);
    if (!localeValidation.ok) {
      renderTranslationRecheckPanel();
      renderTranslationReviewSummary();
      renderReviewChecklist();
      applyActionGuards();
      setInlineStatus("review-status", localeValidation.reason, "error");
      return;
    }
    state.readiness = result?.readiness || state.readiness;
    renderSyncSummary();
    applyImmediateTranslationRecheckResult(result, normalizedLang);
    renderTranslationSummary();
    renderTranslationRecheckPanel();
    renderTranslationReviewSummary();
    renderReviewChecklist();
    applyActionGuards();
    try {
      await refreshTranslations();
    } catch (error) {
      setInlineStatus("review-status", `Translation recheck updated for ${normalizedLang.toUpperCase()} (refresh pending)`, "error");
      return;
    }
    setInlineStatus("review-status", `Translation recheck updated for ${normalizedLang.toUpperCase()}`);
  } finally {
    setBusy(false);
    state.translationRecheckBusyLang = "";
    renderTranslationSummary();
    renderTranslationRecheckPanel();
    renderFinalSendSummary();
    renderReviewChecklist();
    applyActionGuards();
  }
}

async function sendToMainSite() {
  setBusy(true);
  setBanner("กำลังส่งเข้า Admin Review...", "loading");
  try {
    const result = await api(`/api/items/${state.itemId}/submit-admin-review`, { method: "POST" });
    state.item = result?.item || state.item;
    state.articleProcess = result?.article_process || state.articleProcess;
    state.readiness = result?.readiness || state.readiness;
    await refreshArticleProcess();
    await loadTranslations();
    renderAll();
    setBanner("ส่งเข้า Admin Review แล้ว");
  } finally {
    setBusy(false);
    applyActionGuards();
  }
}

function wire() {
  const backHomeBtn = qs("btn-back-home");
  if (backHomeBtn) backHomeBtn.textContent = "\u0e42\u0e2e\u0e21";
  const openIntakeBtn = qs("btn-open-intake");
  if (openIntakeBtn) openIntakeBtn.textContent = "\u0e01\u0e25\u0e31\u0e1a\u0e2b\u0e19\u0e49\u0e32\u0e41\u0e23\u0e01";
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-intake")?.addEventListener("click", () => {
    window.location.href = `/article-intake.html?id=${state.itemId}`;
  });
  qs("btn-open-workspace")?.addEventListener("click", () => {
    window.location.href = workspaceUrl();
  });
  qs("btn-open-review-preview")?.addEventListener("click", () => {
    if (state.token && typeof localStorage !== "undefined") {
      localStorage.setItem("collector_token", state.token);
    }
    window.open(reviewPreviewUrl(), "_blank", "noopener");
  });
  qs("btn-request-revision")?.addEventListener("click", async () => {
    try {
      await requestEditorialRevision(currentReviewNote() || "ส่งกลับเพื่อแก้ไข");
      window.location.href = workspaceUrl();
      setInlineStatus("review-status", "ส่งกลับแก้ไขแล้ว");
    } catch (err) {
      setInlineStatus("review-status", err.message, "error");
    }
  });
  qs("btn-approve-sync")?.addEventListener("click", async () => {
    try {
      const validation = validateWorkspace();
      if (!validation.ok) throw new Error(`Missing: ${validation.missing.join(", ")}`);
      const translationGate = getTranslationGateState();
      if (!translationGate.allReady) throw new Error("ภาษายังไม่พร้อม");
      await transitionArticle("ready_for_sync", currentReviewNote() || "อนุมัติสำหรับเผยแพร่");
      setInlineStatus("review-status", "อนุมัติสำหรับเผยแพร่แล้ว");
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
      await sendToMainSite();
    } catch (err) {
      setBanner(err.message, "error");
    }
  });
  qs("btn-generate-translations")?.addEventListener("click", async () => {
    try {
      await generateTranslations();
    } catch (err) {
      setInlineStatus("translation-status", err.message, "error");
    }
  });
  qs("translation-recheck-panel")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-translation-recheck-lang]");
    if (!button || button.disabled) return;
    try {
      await runTranslationRecheck(button.dataset.translationRecheckLang);
    } catch (err) {
      setInlineStatus("review-status", err.message, "error");
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
    window.location.replace(workspaceUrl(state.itemId));
    return;
  }
  try {
    await loadWorkspace();
    try {
      await loadCurrentReadiness();
    } catch (err) {
      setBanner(`โหลดสถานะความพร้อมไม่สำเร็จ: ${String(err?.message || "unknown error")}`, "error");
    }
    if (!canApproveArticle()) {
      window.location.replace(roleArticleFallbackUrl());
      return;
    }
    renderAll({ syncFields: true });
  } catch (err) {
    const role = currentRole();
    if (
      /forbidden|ไม่มีสิทธิ์/i.test(String(err?.message || ""))
      || role === "editor"
      || role === "freelance"
    ) {
      window.location.replace(roleArticleFallbackUrl());
      return;
    }
    setBanner(err.message, "error");
  }
}

init();


