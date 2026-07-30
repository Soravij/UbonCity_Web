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

export async function loadWorkflowBackwardTransitions(api, itemId) {
  const id = Number(itemId || 0) || 0;
  if (!id) return { item_id: null, can_transition: false, targets: [] };
  return api(`/api/items/${id}/workflow/backward-transitions`);
}

export function renderWorkflowBackwardTransitionControls(root, payload, { busy = false, onTransition } = {}) {
  if (!root) return;
  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  const canTransition = payload?.can_transition === true;
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
