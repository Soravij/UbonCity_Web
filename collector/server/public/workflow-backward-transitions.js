function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function directionLabel(direction) {
  return direction === "cross_process" ? "ถอยข้ามกระบวนการ" : "ถอยในกระบวนการ";
}

const BACKWARD_RESUME_PATH_BY_STATE = {
  ready_for_writer: (id) => `/article-intake.html?id=${id}`,
  field_review: (id) => `/?tab=work&item_id=${id}`,
  field_working: (id) => `/?tab=handoff&item_id=${id}`,
  ready_for_content: (id) => `/?tab=handoff&item_id=${id}`,
  generated: (id) => `/item-editor.html?id=${id}`,
  analyzed: (id) => `/item-editor.html?id=${id}`,
  writing: (id) => `/article-workspace.html?id=${id}`,
  in_review: (id) => `/article-submit.html?id=${id}`,
  ready_for_publish: (id) => `/article-submit.html?id=${id}`,
  submitted_for_admin_review: (id) => `/article-submit.html?id=${id}`,
  writing_assigned: (id) => `/?tab=review&item_id=${id}`,
  collected: (id) => `/item-editor.html?id=${id}`,
};

export function resolveBackwardResumePath(itemId, result) {
  const id = Number(itemId || 0) || 0;
  if (!id) return null;
  const state = String(result?.backward_transitions?.production_state || "").trim().toLowerCase();
  const pathFn = BACKWARD_RESUME_PATH_BY_STATE[state];
  return pathFn ? pathFn(id) : (result?.resume_path || null);
}

export async function loadWorkflowBackwardTransitions(api, itemId) {
  const id = Number(itemId || 0) || 0;
  if (!id) return { item_id: null, can_transition: false, targets: [] };
  return api(`/api/items/${id}/workflow/backward-transitions`);
}

export function renderWorkflowBackwardTransitionControls(root, payload, { busy = false, onTransition } = {}) {
  if (!root) return;
  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  const canTransition = payload?.can_transition === true;
  if (payload?.loadFailed === true) {
    root.classList.remove("hidden");
    root.innerHTML = `<p class="status error">ไม่สามารถโหลดข้อมูลการถอยสถานะได้ ลองรีเฝรชหน้าอีกครั้ง</p>`;
    return;
  }
  root.classList.toggle("hidden", !canTransition || targets.length === 0);
  if (!canTransition || targets.length === 0) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = `
    <label>เหตุผลการถอยกลับ <span aria-hidden="true">*</span></label>
    <textarea data-backward-reason rows="3" placeholder="ระบุเหตุผลก่อนถอยกลับ"></textarea>
    <p data-backward-status class="status"></p>
    <div class="toolbar article-side-actions">
      ${targets.map((target) => `
        <button type="button" class="utility-action" data-backward-target="${escapeHtml(target.production_state)}" ${busy ? "disabled" : ""}>
          ${escapeHtml(directionLabel(target.direction))}: ${escapeHtml(target.label_th || target.production_state)}
        </button>
      `).join("")}
    </div>
  `;
  root.querySelectorAll("[data-backward-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetProductionState = String(button.getAttribute("data-backward-target") || "").trim().toLowerCase();
      const reason = String(root.querySelector("[data-backward-reason]")?.value || "").trim();
      const status = root.querySelector("[data-backward-status]");
      if (!reason) {
        if (status) {
          status.textContent = "ต้องระบุเหตุผลก่อนถอยกลับ";
          status.className = "status error";
        }
        return;
      }
      if (typeof onTransition !== "function") return;
      try {
        if (status) {
          status.textContent = "กำลังอัปเดตสถานะ...";
          status.className = "status muted";
        }
        const target = targets.find((entry) => String(entry?.production_state || "").trim().toLowerCase() === targetProductionState) || null;
        await onTransition({ target, targetProductionState, reason });
      } catch (err) {
        if (status) {
          status.textContent = String(err?.message || "ไม่สามารถถอยสถานะได้");
          status.className = "status error";
        }
      }
    });
  });
}
