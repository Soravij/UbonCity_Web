const state = {
  token: "",
  user: null,
  itemId: Number(new URLSearchParams(window.location.search).get("id") || 0),
  item: null,
  assets: [],
  readiness: null,
  backendSync: null,
  isSubmitting: false,
};

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
  return "";
}

function formatReferenceLabel(reference) {
  const label = String(reference?.label || "").trim();
  if (label) return label;
  const domain = String(reference?.domain || "").trim();
  if (domain) return domain;
  return "เว็บไซต์ทางการ";
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "คำขอล้มเหลว" }));
    const error = new Error(data.error || "คำขอล้มเหลว");
    error.status = Number(res.status || 0);
    error.response = data;
    throw error;
  }

  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("application/json") ? res.json() : null;
}

function setStatus(text, kind = "success") {
  const node = qs("export-status");
  if (!node) return;

  const message = String(text || "").trim();
  if (!message) {
    node.textContent = "";
    node.classList.add("hidden");
    node.classList.remove("is-loading", "is-success", "is-error");
    return;
  }

  node.classList.remove("hidden", "is-loading", "is-success", "is-error");
  if (kind === "loading") node.classList.add("is-loading");
  else if (kind === "error") node.classList.add("is-error");
  else node.classList.add("is-success");

  node.textContent = message;
}

function setSubmitting(isSubmitting) {
  state.isSubmitting = Boolean(isSubmitting);

  ["btn-send-main", "btn-recheck-export", "btn-back-edit", "btn-back-home"].forEach((id) => {
    const node = qs(id);
    if (node) node.disabled = state.isSubmitting;
  });

  const btn = qs("btn-send-main");
  if (btn) btn.textContent = state.isSubmitting ? "กำลังส่ง..." : "ส่งไปเว็บไซต์หลัก";
}

function canSendToMainSite() {
  const role = String(state.user?.role || "").trim().toLowerCase();
  return role === "admin" || role === "owner";
}

function normalizedValue(value) {
  return String(value || "").trim().toLowerCase();
}

function deriveWorkflowStage(item) {
  const publicationState = normalizedValue(item?.publication_state);
  if (publicationState === "published") return "published";
  if (publicationState === "approved" || publicationState === "ready_for_sync") return "approved";

  const productionState = normalizedValue(item?.production_state);
  if (productionState === "generated" || productionState === "ready_for_publish") return "generated";
  if (productionState === "in_review") return "in_review";
  if (productionState === "needs_revision") return "needs_revision";
  if (productionState === "content_in_progress" || productionState === "analyzed" || productionState === "collected") {
    return productionState;
  }
  return "collected";
}

function applyActionGuards() {
  const sendBtn = qs("btn-send-main");
  if (sendBtn) {
    sendBtn.disabled = state.isSubmitting || !canSendToMainSite();
  }
}

function toPreviewBodyHtml(text) {
  const raw = String(text || "").trim();
  if (!raw) return '<p class="muted">ยังไม่มีเนื้อหา</p>';
  return raw
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function renderFrontendPreview() {
  const root = qs("frontend-preview");
  if (!root) return;

  const title = String(state.item?.title || "").trim() || "(ยังไม่มีชื่อเรื่อง)";
  const cover = sanitizeUrl(state.item?.image_url || "");
  const bodyRaw = String(state.item?.description_clean || state.item?.description_raw || "");
  const bodyHtml = toPreviewBodyHtml(bodyRaw);
  const officialReference = state.item?.official_reference && typeof state.item.official_reference === "object"
    ? state.item.official_reference
    : null;
  const officialReferenceUrl = sanitizeUrl(officialReference?.url || "");
  const gallery = (Array.isArray(state.assets) ? state.assets : [])
    .filter((row) => String(row.role || "") === "gallery")
    .map((row) => sanitizeUrl(row.public_url || ""))
    .filter(Boolean);

  const galleryHtml = gallery.length
    ? `<div class="preview-gallery">${gallery.map((url) => `<img src="${escapeHtml(url)}" alt="gallery" />`).join("")}</div>`
    : "";
  const referenceHtml = officialReferenceUrl
    ? `
      <div class="preview-reference">
        <strong>อ้างอิง:</strong>
        <a href="${escapeHtml(officialReferenceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(formatReferenceLabel(officialReference))}</a>
      </div>
    `
    : "";

  root.innerHTML = `
    ${cover ? `<img class="preview-cover" src="${escapeHtml(cover)}" alt="cover" />` : ""}
    <h2 class="preview-title">${escapeHtml(title)}</h2>
    <div class="preview-body">${bodyHtml}</div>
    ${referenceHtml}
    ${galleryHtml}
  `;
}

function renderWorkflowStatus() {
  const box = qs("workflow-status");
  if (!box) return;

  const workflow = deriveWorkflowStage(state.item);
  const readiness = state.readiness || null;
  const counts = readiness?.translation_counts || { passed: 0, failed: 0, stale: 0, not_ready: 0, total: 0 };
  const fieldFlowChecks = readiness?.field_flow_checks || {};
  const humanEditComplete = ["generated", "approved", "published"].includes(workflow)
    || Boolean(fieldFlowChecks.has_article_draft_content)
    || Boolean(readiness?.publishable_source);
  const exportGatePassed = Boolean(readiness?.editorial_ready) || Boolean(readiness?.field_flow_ready);
  const readyToExport = Boolean(readiness?.source_ready) && exportGatePassed && Number(counts.failed || 0) === 0 && Number(counts.stale || 0) === 0;
  const sentToMainSite = workflow === "published";

  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="summary-row"><strong>Human Edit เสร็จแล้ว</strong><span class="${humanEditComplete ? "ok" : "warn"}">${humanEditComplete ? "เสร็จแล้ว" : "รอดำเนินการ"}</span></div>
    <div class="summary-row"><strong>พร้อมส่งออก</strong><span class="${readyToExport ? "ok" : "warn"}">${readyToExport ? "พร้อม" : "ยังไม่พร้อม"}</span></div>
    <div class="summary-row"><strong>ส่งไปเว็บไซต์หลักแล้ว</strong><span class="${sentToMainSite ? "ok" : "warn"}">${sentToMainSite ? "ส่งแล้ว" : "ยังไม่ส่ง"}</span></div>
    <div class="summary-row"><strong>อนุมัติสำหรับเผยแพร่</strong><span class="warn">เฉพาะแอดมินฝั่งหน้าเว็บหลัก</span></div>
  `;
}

function renderBackendSyncSummary(backendSync, fallbackError = "") {
  const box = qs("sync-backend-summary");
  if (!box) return;
  if (!backendSync) {
    box.classList.add("hidden");
    return;
  }

  const ok = backendSync.ok === true;
  const statusCode = Number(backendSync.status || 0);
  const summary = backendSync.payload_summary || {};
  const published = Number(summary.published || 0);
  const translations = Number(summary.translations || 0);
  const result = backendSync.result && typeof backendSync.result === "object" ? backendSync.result : {};
  const resultError = String(result.error || fallbackError || "").trim();

  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="summary-row"><strong>Sync status</strong><span class="${ok ? "ok" : "fail"}">${ok ? "success" : "failed"}</span></div>
    <div class="summary-row"><strong>HTTP status</strong><span>${statusCode || "-"}</span></div>
    <div class="summary-row"><strong>Payload summary</strong><span>published=${published}, translations=${translations}</span></div>
    ${resultError ? `<div class="summary-row"><strong>Error</strong><span class="fail">${escapeHtml(resultError)}</span></div>` : ""}
  `;
}

function renderExportReadiness(readiness) {
  const box = qs("export-readiness");
  if (!box) return;
  if (!readiness) {
    box.classList.add("hidden");
    return;
  }

  const checks = readiness.source_checks || {};
  const issues = Array.isArray(readiness.source_issues) ? readiness.source_issues : [];
  const fieldFlowChecks = readiness.field_flow_checks || {};
  const fieldFlowIssues = Array.isArray(readiness.field_flow_issues) ? readiness.field_flow_issues : [];
  const rows = Array.isArray(readiness.translations) ? readiness.translations : [];
  const counts = readiness.translation_counts || { passed: 0, failed: 0, stale: 0, not_ready: 0, total: 0 };

  const checklist = [
    { label: "รูปปก", pass: Boolean(checks.has_cover) },
    { label: "มีรูปที่เลือกอย่างน้อย 1 รูป", pass: Boolean(checks.has_selected_image) },
    { label: "เนื้อหา", pass: Boolean(checks.has_body) },
    { label: "Meta title", pass: Boolean(checks.has_meta_title) },
    { label: "Meta description", pass: Boolean(checks.has_meta_description) },
    { label: "Slug", pass: Boolean(checks.has_slug) },
  ];

  const translationRows = rows.length
    ? `<ul>${rows.map((row) => `<li>${escapeHtml(row.lang)}: ${escapeHtml(row.status)}</li>`).join("")}</ul>`
    : '<p class="muted">ยังไม่มีข้อมูลความพร้อมด้านการแปล</p>';
  const fieldFlowChecklist = [
    { label: "มี field pack ปัจจุบัน", pass: Boolean(fieldFlowChecks.has_current_field_pack) },
    { label: "มี assignment", pass: Boolean(fieldFlowChecks.has_assignment) },
    { label: "assignment ถูกตรวจรับแล้ว", pass: Boolean(fieldFlowChecks.assignment_accepted) },
    { label: "มี latest submission", pass: Boolean(fieldFlowChecks.has_latest_submission) },
    { label: "มี article draft deliverable", pass: Boolean(fieldFlowChecks.has_article_draft_deliverable) },
    { label: "article draft มีเนื้อหา", pass: Boolean(fieldFlowChecks.has_article_draft_content) },
    { label: "submission ใช้ตรวจต่อได้", pass: Boolean(fieldFlowChecks.deliverables_review_usable) },
    { label: "publication state approved", pass: Boolean(fieldFlowChecks.publication_state_approved) },
  ];
  const publishableSource = readiness.publishable_source || null;
  const publishableArticlePreview = readiness.publishable_article_preview || null;

  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="summary-row"><strong>ความครบถ้วนของข้อมูลต้นทาง</strong><span class="${readiness.source_ready ? "ok" : "fail"}">${readiness.source_ready ? "พร้อม" : "ยังไม่พร้อม"}</span></div>
    <ul>${checklist.map((x) => `<li>${x.pass ? "[OK]" : "[ ]"} ${escapeHtml(x.label)}</li>`).join("")}</ul>
    ${issues.length ? `<ul>${issues.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
    <div class="summary-row"><strong>ความพร้อมจาก flow ปัจจุบัน</strong><span class="${readiness.field_flow_ready ? "ok" : "warn"}">${readiness.field_flow_ready ? "พร้อม" : "ยังไม่พร้อม"}</span></div>
    <ul>${fieldFlowChecklist.map((x) => `<li>${x.pass ? "[OK]" : "[ ]"} ${escapeHtml(x.label)}</li>`).join("")}</ul>
    ${fieldFlowIssues.length ? `<ul>${fieldFlowIssues.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
    ${publishableSource ? `
      <div class="summary-row"><strong>Publishable source</strong><span>assignment #${Number(publishableSource.assignment_id || 0) || "-"} / submission #${Number(publishableSource.latest_submission_id || 0) || "-"}</span></div>
      <div class="summary-row"><strong>Article draft</strong><span>${escapeHtml(String(publishableSource.article_draft_title || "-"))}</span></div>
    ` : ""}
    ${publishableArticlePreview ? `
      <div class="summary-row"><strong>Preview title</strong><span>${escapeHtml(String(publishableArticlePreview.title || "-"))}</span></div>
      <div class="summary-row"><strong>Body length</strong><span>${Number(publishableArticlePreview.body_length || 0)} chars</span></div>
    ` : ""}
    <div class="summary-row"><strong>ความพร้อมด้านการแปล</strong><span>ผ่าน ${counts.passed} / ไม่ผ่าน ${counts.failed} / ต้องอัปเดต ${counts.stale} / ยังไม่พร้อม ${counts.not_ready}</span></div>
    ${translationRows}
  `;
}

async function refreshReadiness() {
  const result = await api(`/api/items/${state.itemId}/recheck-export-readiness`, { method: "POST" });
  state.readiness = result?.readiness || null;
  renderExportReadiness(state.readiness);
  renderWorkflowStatus();
  return state.readiness;
}

async function sendToMainSite() {
  if (state.isSubmitting) return;
  if (!canSendToMainSite()) {
    throw new Error("มีสิทธิ์เฉพาะ admin/owner สำหรับการส่งไปเว็บไซต์หลัก");
  }
  setSubmitting(true);
  applyActionGuards();

  try {
    setStatus("กำลังส่งออกไปเว็บไซต์หลัก...", "loading");

    const readiness = await refreshReadiness();
    if (!readiness?.source_ready) {
      throw new Error("ข้อมูลต้นทางยังไม่พร้อมสำหรับส่งออก");
    }

    setStatus("กำลังตรวจ publish gate และส่งออกเฉพาะรายการนี้...", "loading");
    let result;
    try {
      result = await api(`/api/items/${state.itemId}/release-main`, { method: "POST" });
    } catch (err) {
      state.backendSync = err?.response?.backend_sync || null;
      renderBackendSyncSummary(state.backendSync, String(err?.message || ""));
      throw err;
    }

    state.item = result?.item || await api(`/api/items/${state.itemId}`);
    state.readiness = result?.readiness || await refreshReadiness();
    state.backendSync = result?.backend_sync || null;
    renderBackendSyncSummary(state.backendSync);
    setStatus("ส่งสำเร็จ กำลังกลับไปหน้ารายการ...", "success");
    window.location.href = `/?status=sent_main_site&item_id=${state.itemId}`;
  } finally {
    setSubmitting(false);
    applyActionGuards();
  }
}

function wire() {
  const backEditBtn = qs("btn-back-edit");
  if (backEditBtn) backEditBtn.textContent = "กลับหน้าแรก";
  const backHomeBtn = qs("btn-back-home");
  if (backHomeBtn) backHomeBtn.textContent = "โฮม";
  qs("btn-back-edit")?.addEventListener("click", () => {
    window.location.href = `/article-submit.html?id=${state.itemId}`;
  });

  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });

  qs("btn-recheck-export")?.addEventListener("click", async () => {
    try {
      setStatus("กำลังตรวจความพร้อมอีกครั้ง...", "loading");
      await refreshReadiness();
      setStatus("อัปเดตสถานะความพร้อมแล้ว", "success");
    } catch (err) {
      setStatus(err.message, "error");
    }
  });

  qs("btn-send-main")?.addEventListener("click", async () => {
    try {
      await sendToMainSite();
    } catch (err) {
      setStatus(`ส่งออกไปเว็บไซต์หลักไม่สำเร็จ: ${err.message}`, "error");
    }
  });
}

(async () => {
  try {
    if (!state.itemId) throw new Error("ไม่พบ item id");

    const me = await api("/api/auth/me");
    state.user = me.user;
    qs("export-auth-status").textContent = `เข้าสู่ระบบ: ${me.user.email} (${me.user.role})`;

    wire();
    applyActionGuards();

    state.item = await api(`/api/items/${state.itemId}`);
    state.assets = await api(`/api/assets?content_item_id=${state.itemId}&only_selected=1`);
    state.assets = Array.isArray(state.assets) ? state.assets : [];
    await refreshReadiness();
    renderBackendSyncSummary(state.backendSync);
    renderFrontendPreview();
    setStatus(`โหลดรายการ ${state.itemId} แล้ว`, "success");
  } catch (err) {
    setStatus(err.message, "error");
  }
})();
