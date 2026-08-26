const DEFAULT_STATE_GROUPS = new Set(["assignment", "production"]);
const DEFAULT_LIMIT = 20;

export function selectHistoryRows(rows = [], showAll = false) {
  const list = Array.isArray(rows) ? rows : [];
  const filtered = showAll
    ? list
    : list.filter((row) => DEFAULT_STATE_GROUPS.has(String(row?.state_group || "").trim().toLowerCase()));
  const sorted = [...filtered].sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
  return showAll ? sorted : sorted.slice(0, DEFAULT_LIMIT);
}

const MODAL_HTML = `
<div id="item-history-modal" class="modal hidden" aria-hidden="true">
  <div class="modal-card">
    <div class="modal-header">
      <h3>ประวัติของ item</h3>
      <button id="btn-item-history-close">ปิด</button>
    </div>
    <div class="toolbar compact-toolbar">
      <span class="status" id="item-history-status"></span>
      <button id="btn-item-history-toggle-all">แสดงทั้งหมด</button>
    </div>
    <div id="item-history-list" class="intake-list"></div>
  </div>
</div>`;

let cachedItemId = 0;
let cachedRows = [];
let showAll = false;
let getItemId = () => 0;
let fetchJson = null;

function render() {
  const list = document.getElementById("item-history-list");
  const status = document.getElementById("item-history-status");
  if (!list || !status) return;
  const rows = selectHistoryRows(cachedRows, showAll);
  status.textContent = `item #${cachedItemId} · แสดง ${rows.length} จาก ${cachedRows.length} แถว`;
  list.innerHTML = rows
    .map((row) => {
      const group = String(row?.state_group || "").trim();
      const from = String(row?.from_state || "").trim() || "none";
      const to = String(row?.to_state || "").trim() || "none";
      const actor = String(row?.actor_email || "").trim() || "system";
      const reason = String(row?.reason_code || "").trim();
      const when = String(row?.created_at || "").trim();
      const note = String(row?.note || "").trim();
      return `<div><strong>${group}</strong> ${from} → ${to}
        <p class="muted">${when} · ${actor}${reason ? ` · ${reason}` : ""}${note ? ` · ${note}` : ""}</p></div>`;
    })
    .join("") || `<p class="muted">ไม่มีประวัติในกลุ่มที่แสดงอยู่</p>`;
}

function setOpen(open) {
  const modal = document.getElementById("item-history-modal");
  if (!modal) return;
  modal.classList.toggle("hidden", !open);
  modal.setAttribute("aria-hidden", open ? "false" : "true");
}

async function openPanel() {
  const itemId = Number(getItemId() || 0) || 0;
  setOpen(true);
  const status = document.getElementById("item-history-status");
  const list = document.getElementById("item-history-list");
  if (!itemId) {
    if (status) status.textContent = "";
    if (list) list.innerHTML = `<p class="muted">หน้านี้ยังไม่ได้เลือก item — เปิด item ก่อนจึงจะดูประวัติได้</p>`;
    return;
  }
  if (itemId !== cachedItemId) {
    cachedRows = [];
    cachedItemId = itemId;
    showAll = false;
    if (status) status.textContent = "กำลังโหลด...";
    if (list) list.innerHTML = "";
    try {
      const data = await fetchJson(`/api/items/${itemId}/transitions?limit=200`);
      cachedRows = Array.isArray(data?.transitions) ? data.transitions : [];
    } catch (err) {
      cachedItemId = 0;
      if (status) status.textContent = "";
      if (list) list.innerHTML = `<p class="muted">ดูประวัติไม่ได้: ${String(err?.message || err)}</p>`;
      return;
    }
  }
  render();
}

export function initItemHistory(options = {}) {
  fetchJson = options?.fetchJson;
  getItemId = typeof options?.getItemId === "function" ? options.getItemId : () => 0;
  const header = document.querySelector("header.header");
  if (!header || typeof fetchJson !== "function") return;
  const button = document.createElement("button");
  button.id = "btn-item-history";
  button.textContent = "ประวัติ";
  header.appendChild(button);
  document.body.insertAdjacentHTML("beforeend", MODAL_HTML);
  button.addEventListener("click", () => { openPanel(); });
  document.getElementById("btn-item-history-close")?.addEventListener("click", () => setOpen(false));
  document.getElementById("btn-item-history-toggle-all")?.addEventListener("click", (event) => {
    showAll = !showAll;
    event.target.textContent = showAll ? "แสดงเฉพาะที่สำคัญ" : "แสดงทั้งหมด";
    render();
  });
}
