const state = {
  token: sessionStorage.getItem("collector_token") || localStorage.getItem("collector_token") || "",
  user: null,
  items: [],
  processByItemId: {},
  users: [],
  busy: false,
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

function isPrivilegedEventUser() {
  const role = currentRole();
  return role === "owner" || role === "admin" || role === "user";
}

function eventItems() {
  return (Array.isArray(state.items) ? state.items : [])
    .filter((item) => String(item?.type || "").trim().toLowerCase() === "event")
    .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
}

function processForItem(itemId) {
  return state.processByItemId[Number(itemId || 0)] || null;
}

function primaryAssignmentForItem(itemId) {
  const process = processForItem(itemId);
  if (!process) return null;
  if (process.active_editorial_assignment) return process.active_editorial_assignment;
  const assignments = Array.isArray(process.editorial_assignments) ? process.editorial_assignments : [];
  return assignments[0] || null;
}

function normalizedValue(value) {
  return String(value || "").trim().toLowerCase();
}

function derivedArticleWorkflowStatus(item, process = processForItem(item?.id)) {
  const processStatus = normalizedValue(process?.status);
  if (processStatus === "synced_to_admin") return "published";
  if (processStatus === "submitted_for_admin_review") return "approved";
  if (processStatus === "ready_for_sync") return "approved";
  if (processStatus === "ready_for_review") return "in_review";
  if (processStatus === "revision_requested") return "needs_revision";
  if (processStatus === "drafting") return "content_in_progress";

  const publicationState = normalizedValue(item?.publication_state);
  if (publicationState === "published") return "published";
  if (publicationState === "ready_for_sync" || publicationState === "approved") return "approved";

  const productionState = normalizedValue(item?.production_state);
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

function writerOptionsHtml(selectedId = 0) {
  const options = ['<option value="">-- ยังไม่ assign --</option>'];
  for (const row of state.users) {
    const id = Number(row?.id || 0) || 0;
    if (!id) continue;
    const label = String(row?.display_name || row?.email || `user #${id}`).trim();
    const role = String(row?.role || "").trim().toLowerCase();
    options.push(`<option value="${id}" ${id === selectedId ? "selected" : ""}>${escapeHtml(label)} (${escapeHtml(role)})</option>`);
  }
  return options.join("");
}

function routeForItem(item) {
  const status = derivedArticleWorkflowStatus(item);
  const id = Number(item?.id || 0) || 0;
  if (status === "in_review" || status === "approved" || status === "unpublished" || status === "published") {
    return `/event-submit.html?id=${id}`;
  }
  return `/event-workspace.html?id=${id}`;
}

function renderCreateAssigneeOptions() {
  const select = qs("event-create-assignee");
  if (!select) return;
  select.innerHTML = writerOptionsHtml(0);
}

function workflowStatusPillClass(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved" || normalized === "published" || normalized === "submitted" || normalized === "content_in_progress") {
    return "status-pill status-active";
  }
  return "status-pill status-inactive";
}

function renderEventsTable() {
  const tbody = qs("events-table")?.querySelector("tbody");
  if (!tbody) return;
  const rows = eventItems();
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">ยังไม่มี event</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((item) => {
    const id = Number(item?.id || 0) || 0;
    const assignment = primaryAssignmentForItem(id);
    const workflowStatus = derivedArticleWorkflowStatus(item) || "draft";
    const statusClass = workflowStatusPillClass(workflowStatus);
    const assigneeName = assignment?.assignee_display_name || assignment?.assignee_email || assignment?.assignee_name || "-";
    return `
      <tr>
        <td>${id}</td>
        <td>
          <div><strong>${escapeHtml(item?.title || "(untitled)")}</strong></div>
          <div><span class="workflow-badge workflow-badge-generated">Event</span></div>
        </td>
        <td><span class="${statusClass}">${escapeHtml(workflowStatus)}</span></td>
        <td>${escapeHtml(assigneeName)}</td>
        <td>
          <div class="toolbar compact-toolbar">
            <select data-role="assign-user" data-id="${id}">
              ${writerOptionsHtml(Number(assignment?.assignee_user_id || 0) || 0)}
            </select>
            <button type="button" data-action="assign" data-id="${id}">Assign</button>
          </div>
        </td>
        <td class="table-actions">
          <button type="button" data-action="open" data-id="${id}">เปิดงาน</button>
        </td>
      </tr>
    `;
  }).join("");
}

async function loadPage() {
  const me = await api("/api/auth/me");
  state.user = me?.user || null;
  if (!isPrivilegedEventUser()) {
    window.location.replace("/");
    return;
  }
  const [items, assignableUsers] = await Promise.all([
    api("/api/items"),
    api("/api/users/assignable?kind=editorial"),
  ]);
  state.items = Array.isArray(items) ? items : [];
  state.users = (Array.isArray(assignableUsers?.items) ? assignableUsers.items : []).filter((row) => {
    const role = String(row?.role || "").trim().toLowerCase();
    return role === "editor" || role === "user" || role === "admin" || role === "owner";
  });
  const eventRows = eventItems();
  const processes = await Promise.all(eventRows.map(async (item) => {
    try {
      return [Number(item.id || 0), await api(`/api/items/${Number(item.id || 0)}/article-process`)];
    } catch {
      return [Number(item.id || 0), null];
    }
  }));
  state.processByItemId = Object.fromEntries(processes);
  const authNode = qs("workspace-auth-status");
  if (authNode) authNode.textContent = `ล็อกอินเป็น ${state.user?.display_name || state.user?.email || "-"} (${currentRole()})`;
  renderCreateAssigneeOptions();
  renderEventsTable();
}

async function assignWriter(itemId, assigneeUserId) {
  await api(`/api/items/${itemId}/article-editorial-assignments`, {
    method: "POST",
    body: JSON.stringify({
      assignee_user_id: assigneeUserId,
      replace_active: true,
    }),
  });
}

async function createEvent() {
  const title = String(qs("event-create-title")?.value || "").trim();
  const assigneeUserId = Number(qs("event-create-assignee")?.value || 0) || 0;
  if (!title) throw new Error("กรุณากรอก title");
  const item = await api("/api/events-manager/items", {
    method: "POST",
    body: JSON.stringify({
      title,
    }),
  });
  const itemId = Number(item?.id || 0) || 0;
  if (!itemId) throw new Error("สร้าง event ไม่สำเร็จ");
  if (assigneeUserId > 0) {
    await assignWriter(itemId, assigneeUserId);
  }
}

function wire() {
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-process-home")?.addEventListener("click", () => {
    window.location.href = "/events.html";
  });
  qs("btn-create-event")?.addEventListener("click", async () => {
    setInlineStatus("create-status", "กำลังสร้าง...", "loading");
    try {
      await createEvent();
      qs("event-create-title").value = "";
      qs("event-create-assignee").value = "";
      await loadPage();
      setInlineStatus("create-status", "สร้าง event แล้ว");
    } catch (err) {
      setInlineStatus("create-status", err.message, "error");
    }
  });
  qs("events-table")?.querySelector("tbody")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const itemId = Number(button.dataset.id || 0) || 0;
    if (!itemId) return;
    if (button.dataset.action === "open") {
      const item = eventItems().find((row) => Number(row?.id || 0) === itemId);
      if (!item) return;
      window.location.href = routeForItem(item);
      return;
    }
    if (button.dataset.action === "assign") {
      const select = document.querySelector(`select[data-role="assign-user"][data-id="${itemId}"]`);
      const assigneeUserId = Number(select?.value || 0) || 0;
      if (!assigneeUserId) {
        setBanner("เลือกผู้เขียนก่อน assign", "error");
        return;
      }
      setBanner("กำลัง assign...", "loading");
      try {
        await assignWriter(itemId, assigneeUserId);
        await loadPage();
        setBanner("assign ผู้เขียนแล้ว");
      } catch (err) {
        setBanner(err.message, "error");
      }
    }
  });
}

wire();
loadPage().catch((err) => {
  setBanner(err.message, "error");
});
