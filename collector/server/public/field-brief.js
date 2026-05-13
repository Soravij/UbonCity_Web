const state = {
  token: sessionStorage.getItem("collector_token") || localStorage.getItem("collector_token") || "",
  user: null,
  itemId: Number(new URLSearchParams(window.location.search).get("id") || 0),
  assignmentId: Number(new URLSearchParams(window.location.search).get("assignment_id") || 0),
  assignment: null,
  item: null,
  fieldPack: null,
  assets: [],
  evidenceBlocks: [],
  approvedContextBlocks: [],
};

const AUTH_RETURN_TO_KEY = "collector_return_to";

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

function sanitizeRelativeReturnTo(value) {
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "";
  return raw;
}

function parsePositiveInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function buildAssignmentWorkUrl(itemId, assignmentId = 0) {
  const params = new URLSearchParams();
  params.set("tab", "work");
  const normalizedItemId = parsePositiveInt(itemId);
  const normalizedAssignmentId = parsePositiveInt(assignmentId);
  if (normalizedItemId > 0) params.set("item_id", String(normalizedItemId));
  if (normalizedAssignmentId > 0) params.set("assignment_id", String(normalizedAssignmentId));
  return `/?${params.toString()}`;
}

function rolePortalUrl(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "editor") return "/editor-home.html";
  if (normalizedRole === "freelance") return buildAssignmentWorkUrl(state.itemId, state.assignmentId);
  return "/";
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

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const res = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "คำขอล้มเหลว" }));
    if (res.status === 401 && path !== "/api/auth/login") {
      redirectToLoginWithReturnTo();
    }
    throw new Error(data.error || "คำขอล้มเหลว");
  }
  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("application/json") ? res.json() : null;
}

async function apiOptional(path, options = {}) {
  try {
    return await api(path, options);
  } catch (err) {
    const message = String(err?.message || "").trim().toLowerCase();
    if (message.includes("forbidden") || message.includes("freelance access is limited")) {
      return null;
    }
    throw err;
  }
}

function setStatus(text, isError = false) {
  const node = qs("brief-status");
  if (!node) return;
  node.textContent = String(text || "");
  node.style.color = isError ? "#b42318" : "#1f8a52";
}

function formatDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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

function splitPipeParts(line) {
  return String(line || "").split("|").map((part) => String(part || "").trim());
}

function parseLineList(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
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

function classifyEvidenceSourceFamily(row = {}) {
  const backendFamily = String(row.source_family || "").trim().toLowerCase();
  if (backendFamily === "official") return { key: "official", label: "เว็บไซต์ทางการ" };
  if (backendFamily === "institutional") return { key: "institutional", label: "เว็บไซต์หน่วยงาน" };
  if (backendFamily === "google_maps") return { key: "google_maps", label: "Google Maps" };
  if (backendFamily === "google") return { key: "google", label: "Google" };
  if (backendFamily === "wongnai") return { key: "wongnai", label: "Wongnai" };

  const sourceType = String(row.source_type || "").trim().toLowerCase();
  const host = deriveHostName(row.source_url || row.url || "");
  if (sourceType === "google_maps" || /^maps\.google\./i.test(host)) {
    return { key: "google_maps", label: "Google Maps" };
  }
  if (sourceType === "google" || /(?:^|\.)google\./i.test(host)) {
    return { key: "google", label: "Google" };
  }
  if (sourceType === "wongnai" || /(?:^|\.)wongnai\.com$/i.test(host)) {
    return { key: "wongnai", label: "Wongnai" };
  }
  if (/(\.go\.th|\.ac\.th|\.or\.th|\.gov|\.edu)$/i.test(host)) {
    return { key: "institutional", label: "เว็บไซต์หน่วยงาน" };
  }
  if (sourceType === "official" || sourceType === "official_site") {
    return { key: "official", label: "เว็บไซต์ทางการ" };
  }
  return { key: "manual", label: "เพิ่มเอง" };
}

function getReadableSourceShortLabel(row = {}) {
  const url = String(row.url || row.source_url || "").trim();
  const family = classifyEvidenceSourceFamily({
    source_family: row.source_family,
    source_type: row.source_type,
    source_url: url,
  });
  if (family.key === "google_maps" || family.key === "google" || family.key === "wongnai") {
    return family.label;
  }
  const host = deriveHostName(url);
  if (host) return host;
  const fallbackLabel = String(row.label || "").trim();
  if (fallbackLabel) return fallbackLabel;
  return family.label;
}

function getFieldProgressStatusLabel(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "draft") return "กำลังเตรียมงาน";
  if (value === "ready_for_field" || value === "ready_for_handoff") return "พร้อมส่งเข้า handoff";
  if (value === "field_in_progress") return "กำลังลงหน้างาน";
  if (value === "field_done") return "ลงหน้างานแล้ว";
  if (value === "on_hold") return "พักไว้";
  return "กำลังเตรียมงาน";
}

function buildReferenceRows() {
  const rows = [];
  rows.push(...(Array.isArray(state.fieldPack?.references) ? state.fieldPack.references : []));
  if (!rows.length) {
    rows.push(...(Array.isArray(state.assignment?.brief_json?.references) ? state.assignment.brief_json.references : []));
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
    const legacyName = String(state.item?.source_name || "").trim();
    const legacyUrl = String(state.item?.source_url || "").trim();
    if (legacyName || legacyUrl) {
      rows.push({ label: legacyName, url: legacyUrl, source_family: "manual" });
    }
  }
  return rows;
}

function buildReferenceSummary() {
  const labels = [];
  const seen = new Set();
  for (const row of buildReferenceRows()) {
    const label = getReadableSourceShortLabel(row);
    const key = String(label || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

function findAssignment(scope) {
  return (Array.isArray(state.fieldPack?.assignments) ? state.fieldPack.assignments : [])
    .find((row) => String(row.assignment_scope || "").trim() === scope) || null;
}

function getAssignmentBrief() {
  return state.assignment?.brief_json && typeof state.assignment.brief_json === "object"
    ? state.assignment.brief_json
    : null;
}

function listChecklistTexts(items, checklistType) {
  return (Array.isArray(items) ? items : [])
    .filter((row) => String(row?.checklist_type || "").trim() === checklistType)
    .map((row) => String(row?.item_text || "").trim())
    .filter(Boolean);
}

function getPackList(key, checklistType = "") {
  const brief = getAssignmentBrief();
  const direct = state.fieldPack?.[key];
  if (Array.isArray(direct)) {
    return direct.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const jsonField = state.fieldPack?.[`${key}_json`];
  if (Array.isArray(jsonField)) {
    return jsonField.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (checklistType) {
    const fromChecklist = listChecklistTexts(state.fieldPack?.checklists, checklistType);
    if (fromChecklist.length) return fromChecklist;
  }
  if (brief) {
    if (key === "must_verify_facts") {
      const verifiedFacts = Array.isArray(brief?.evidence_summary?.verified_facts) ? brief.evidence_summary.verified_facts : [];
      const nextActions = Array.isArray(brief?.next_actions) ? brief.next_actions : [];
      return [...verifiedFacts, ...nextActions].map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (key === "must_capture_shots" || key === "social_shot_emphasis") {
      return (Array.isArray(brief?.shot_list_suggestions) ? brief.shot_list_suggestions : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    }
    if (key === "must_ask_questions") {
      return (Array.isArray(brief?.next_actions) ? brief.next_actions : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    }
    if (key === "social_on_camera_points") {
      return (Array.isArray(brief?.script_suggestions) ? brief.script_suggestions : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    }
  }
  return [];
}

function renderListBlock(id, items, emptyText) {
  const root = qs(id);
  if (!root) return;
  const rows = (Array.isArray(items) ? items : []).map((x) => String(x || "").trim()).filter(Boolean);
  if (!rows.length) {
    root.innerHTML = `<p class="muted">${escapeHtml(emptyText)}</p>`;
    return;
  }
  root.innerHTML = `<ul class="brief-list">${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderSummary() {
  const root = qs("brief-summary");
  if (!root) return;
  const brief = getAssignmentBrief();
  const summary = String(state.fieldPack?.editor_summary || state.fieldPack?.ai_summary || brief?.brief_summary || "").trim();
  const angle = String(state.fieldPack?.story_angle || brief?.recommended_hook || "").trim();
  const notes = String(state.fieldPack?.field_notes || "").trim();

  root.innerHTML = `
    <div class="brief-grid">
      <div class="brief-panel">
        <div class="brief-panel-label">สรุปงานสำหรับทีมภาคสนาม</div>
        <div>${escapeHtml(summary || "ยังไม่มีสรุปสำหรับทีมภาคสนาม")}</div>
      </div>
      <div class="brief-panel">
        <div class="brief-panel-label">มุมเล่าเรื่อง</div>
        <div>${escapeHtml(angle || "ยังไม่ได้กำหนดมุมเล่าเรื่อง")}</div>
      </div>
      <div class="brief-panel brief-panel-full">
        <div class="brief-panel-label">หมายเหตุหน้างาน</div>
        <div>${escapeHtml(notes || "ไม่มีหมายเหตุเพิ่มเติม")}</div>
      </div>
    </div>
  `;
}

function renderSocialBlock() {
  const root = qs("brief-social");
  if (!root) return;
  const brief = getAssignmentBrief();
  const hook = String(state.fieldPack?.social_hook || brief?.recommended_hook || "").trim();
  const onCamera = getPackList("social_on_camera_points");
  const captionAngle = String(
    state.fieldPack?.social_caption_angle
    || (Array.isArray(brief?.caption_suggestions) ? brief.caption_suggestions[0] : "")
    || ""
  ).trim();
  const shotEmphasis = getPackList("social_shot_emphasis");

  root.innerHTML = `
    <div class="brief-panel">
      <div class="brief-panel-label">Hook</div>
      <div>${escapeHtml(hook || "ยังไม่ได้กำหนด Hook")}</div>
    </div>
    <div class="brief-panel">
      <div class="brief-panel-label">แนวทาง Caption</div>
      <div>${escapeHtml(captionAngle || "ยังไม่ได้กำหนดแนวทาง Caption")}</div>
    </div>
    <div class="brief-panel">
      <div class="brief-panel-label">ช็อตที่ควรเน้น</div>
      ${shotEmphasis.length
        ? `<ul class="brief-list">${shotEmphasis.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : '<p class="muted">ยังไม่ได้กำหนดช็อตที่ควรเน้น</p>'}
    </div>
    <div class="brief-panel">
      <div class="brief-panel-label">ประเด็นที่พูดหน้ากล้อง</div>
      ${onCamera.length
        ? `<ul class="brief-list">${onCamera.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
        : '<p class="muted">ยังไม่ได้กำหนดประเด็นที่พูดหน้ากล้อง</p>'}
    </div>
  `;
}

function renderMediaHints() {
  const root = qs("brief-media-hints");
  if (!root) return;
  const hints = Array.isArray(state.fieldPack?.media_hints) ? state.fieldPack.media_hints : [];
  const assetById = new Map(
    (Array.isArray(state.assets) ? state.assets : [])
      .filter((row) => Number(row?.id || 0) > 0)
      .map((row) => [Number(row.id || 0), row])
  );
  const rows = hints
    .filter((hint) => {
      const selected = Number(hint?.selected || 0) === 1;
      const hasAssetBinding = Number(hint?.content_asset_id || 0) > 0;
      return selected || hasAssetBinding;
    })
    .map((hint) => {
      const asset = assetById.get(Number(hint?.content_asset_id || 0)) || null;
      const url = sanitizeUrl(hint?.url || asset?.public_url || "");
      return {
        url,
        kind: String(hint?.kind || asset?.role || "reference").trim() || "reference",
        caption: String(hint?.caption || "").trim(),
      };
    })
    .filter((row) => row.url);

  if (!rows.length) {
    root.innerHTML = '<p class="muted">ยังไม่มีภาพอ้างอิงในชุดนี้</p>';
    return;
  }

  root.innerHTML = rows.map((row) => `
    <figure class="brief-media-card">
      <img src="${escapeHtml(row.url)}" alt="ภาพอ้างอิง" />
      <figcaption>
        <strong>${escapeHtml(row.kind)}</strong>
        ${row.caption ? `<span>${escapeHtml(row.caption)}</span>` : ""}
      </figcaption>
    </figure>
  `).join("");
}

function renderReferences() {
  const root = qs("brief-references");
  if (!root) return;
  const labels = buildReferenceSummary();
  if (!labels.length) {
    root.innerHTML = '<p class="muted">ยังไม่มีแหล่งอ้างอิงที่ดึงมาแล้ว</p>';
    return;
  }
  root.innerHTML = `
    <div class="source-summary-list">
      ${labels.map((label) => `<span class="source-summary-chip">${escapeHtml(label)}</span>`).join("")}
    </div>
  `;
}

function renderAssignment() {
  const root = qs("brief-assignment");
  if (!root) return;
  const fieldAssignment = state.assignment || findAssignment("field");
  if (!fieldAssignment) {
    root.innerHTML = '<p class="muted">ยังไม่มีข้อมูลการมอบหมายงานภาคสนาม</p>';
    return;
  }
  root.innerHTML = `
    <div class="brief-panel">
      <div class="brief-panel-label">ผู้รับงาน</div>
      <div>${escapeHtml(String(fieldAssignment.assignee_display_name || fieldAssignment.assigned_name || fieldAssignment.assignee_name || fieldAssignment.assignee_email || "").trim() || "-")}</div>
    </div>
    <div class="brief-panel">
      <div class="brief-panel-label">บทบาท</div>
      <div>${escapeHtml(String(fieldAssignment.assigned_role || fieldAssignment.assignment_kind || "").trim() || "-")}</div>
    </div>
    <div class="brief-panel">
      <div class="brief-panel-label">กำหนดส่ง</div>
      <div>${escapeHtml(formatDateTime(fieldAssignment.due_at))}</div>
    </div>
    <div class="brief-panel brief-panel-full">
      <div class="brief-panel-label">หมายเหตุการมอบหมาย</div>
      <div>${escapeHtml(String(fieldAssignment.note || "").trim() || "ไม่มีหมายเหตุเพิ่มเติม")}</div>
    </div>
  `;
}

function renderHeader() {
  const item = state.item || {};
  const pack = state.fieldPack || {};
  const title = String(item.title || "").trim() || `item #${parsePositiveInt(state.itemId) || parsePositiveInt(state.assignment?.content_item_id) || "-"}`;
  const category = String(item.category || "").trim() || "-";
  const type = String(item.type || "").trim() || "-";
  const lat = String(item.lat || "").trim();
  const lng = String(item.lng || "").trim();
  const locationText = lat && lng ? `${lat}, ${lng}` : "-";

  if (qs("brief-title")) qs("brief-title").textContent = title;
  if (qs("brief-meta-line")) qs("brief-meta-line").textContent = `ประเภท: ${type} | หมวด: ${category}`;
  if (qs("brief-status-label")) qs("brief-status-label").textContent = getFieldProgressStatusLabel(pack.status);
  if (qs("brief-location")) qs("brief-location").textContent = locationText;
  if (qs("brief-generated-at")) qs("brief-generated-at").textContent = formatDateTime(new Date().toISOString());
  if (qs("brief-generated-by")) qs("brief-generated-by").textContent = String(state.user?.email || "-");
  [
    qs("brief-status-label"),
    qs("brief-location"),
    qs("brief-generated-at"),
    qs("brief-generated-by"),
  ].forEach((node) => {
    const wrap = node?.parentElement || null;
    if (!wrap) return;
    const value = String(node.textContent || "").trim();
    wrap.classList.toggle("field-brief-meta-empty", !value || value === "-");
  });
}

function renderPage() {
  renderHeader();
  renderSummary();
  renderListBlock("brief-verify", getPackList("must_verify_facts", "must_verify_fact"), "ยังไม่ได้ระบุสิ่งที่ต้องยืนยัน");
  renderListBlock("brief-shots", getPackList("must_capture_shots", "must_capture_shot"), "ยังไม่ได้ระบุช็อตที่ต้องเก็บ");
  renderListBlock("brief-questions", getPackList("must_ask_questions", "must_ask_question"), "ยังไม่ได้ระบุคำถามที่ต้องถาม");
  renderSocialBlock();
  renderMediaHints();
  renderReferences();
  renderAssignment();
}

function wire() {
  const backEditorBtn = qs("btn-back-editor");
  if (backEditorBtn) backEditorBtn.textContent = "กลับหน้าแรก";
  const backHomeBtn = qs("btn-back-home");
  if (backHomeBtn) backHomeBtn.textContent = "โฮม";
  qs("btn-back-editor")?.addEventListener("click", () => {
    const role = String(state.user?.role || "").trim().toLowerCase();
    if (role === "freelance") {
      window.location.href = buildAssignmentWorkUrl(state.itemId, state.assignmentId);
      return;
    }
    window.location.href = `/item-editor.html?id=${state.itemId}`;
  });
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = rolePortalUrl(state.user?.role);
  });
  qs("btn-print-brief")?.addEventListener("click", () => {
    window.print();
  });
}

(async () => {
  try {
    const me = await api("/api/auth/me");
    state.user = me.user;
    qs("brief-auth-status").textContent = "";

    wire();
    if (state.assignmentId > 0) {
      const assignmentRes = await api(`/api/assignments/${state.assignmentId}`);
      state.assignment = assignmentRes?.assignment || null;
      if (!state.itemId && Number(state.assignment?.content_item_id || 0) > 0) {
        state.itemId = Number(state.assignment.content_item_id || 0) || 0;
      }
    }
    if (!state.itemId) throw new Error("ไม่พบ item id");

    const extendedSourceRequests = String(state.user?.role || "").toLowerCase() === "freelance"
      ? [Promise.resolve(null), Promise.resolve(null)]
      : [
          apiOptional(`/api/items/${state.itemId}/evidence-blocks`),
          apiOptional(`/api/items/${state.itemId}/approved-context`),
        ];

    const itemRequest = apiOptional(`/api/items/${state.itemId}`);
    const [item, fieldPackRes, assets, evidenceRes, approvedContextRes] = await Promise.all([
      itemRequest,
      api(`/api/items/${state.itemId}/field-pack/current`),
      api(`/api/assets?content_item_id=${state.itemId}&only_selected=1`),
      ...extendedSourceRequests,
    ]);

    state.item = item || null;
    state.fieldPack = fieldPackRes?.field_pack || {};
    state.assets = Array.isArray(assets) ? assets : [];
    state.evidenceBlocks = Array.isArray(evidenceRes?.blocks) ? evidenceRes.blocks : [];
    state.approvedContextBlocks = Array.isArray(approvedContextRes?.blocks) ? approvedContextRes.blocks : [];
    renderPage();
    setStatus(`โหลดสรุปหน้างานของรายการ ${state.itemId} แล้ว`);
  } catch (err) {
    setStatus(err.message, true);
  }
})();



