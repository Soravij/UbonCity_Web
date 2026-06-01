export function qs(id) {
  return document.getElementById(id);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function api(path, options = {}) {
const token = sessionStorage.getItem("collector_token") || localStorage.getItem("collector_token") || "";
  const headers = { ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function requireAdminShell(statusNodeId = "workspace-status", authNodeId = "workspace-auth-status") {
  const me = await api("/api/auth/me");
  const user = me?.user || null;
  const role = String(user?.role || "").trim().toLowerCase();
  if (role !== "owner" && role !== "admin" && role !== "user") {
    throw new Error("forbidden");
  }
  const authNode = qs(authNodeId);
  if (authNode) authNode.textContent = `ล็อกอินเป็น ${user?.display_name || user?.email || "-"} (${role})`;
  const statusNode = qs(statusNodeId);
  if (statusNode) {
    statusNode.textContent = "";
    statusNode.classList.add("hidden");
  }
  return { user, role };
}

export function setBanner(id, message = "", isError = false) {
  const node = qs(id);
  if (!node) return;
  const text = String(message || "").trim();
  node.textContent = text;
  node.classList.toggle("hidden", !text);
  node.classList.toggle("fail", Boolean(text && isError));
}
