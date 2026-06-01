async function api(path, options = {}) {
  const token = sessionStorage.getItem("collector_token") || localStorage.getItem("collector_token") || "";
  const headers = {
    ...(options.headers || {}),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(path, {
    ...options,
    headers,
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!res.ok) {
    const error = new Error(payload?.error || `Request failed (${res.status})`);
    error.status = res.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function qs(id) {
  return document.getElementById(id);
}

function setStatus(message = "", isError = false) {
  const node = qs("workspace-status");
  if (!node) return;
  node.textContent = String(message || "").trim();
  node.classList.toggle("hidden", !message);
  node.classList.toggle("fail", Boolean(message && isError));
}

function currentRole(user) {
  return String(user?.role || "").trim().toLowerCase();
}

function rolePortalUrl(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "editor") return "/editor-home.html";
  if (normalizedRole === "freelance") return "/freelance-home.html";
  return "/";
}

async function init() {
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-transport-map-manager")?.addEventListener("click", () => {
    window.location.href = "/transport-v2-routes.html";
  });
  qs("btn-open-transport-base-maps")?.addEventListener("click", () => {
    window.location.href = "/transport-v2-base-maps.html";
  });
  qs("btn-open-other-transport-manager")?.addEventListener("click", () => {
    window.location.href = "/other-transport.html";
  });

  try {
    const me = await api("/api/auth/me");
    const user = me?.user || null;
    const role = currentRole(user);
    if (role !== "owner" && role !== "admin" && role !== "user") {
      window.location.replace(rolePortalUrl(role));
      return;
    }
    if (role === "owner") {
      qs("btn-open-transport-base-maps")?.classList.remove("hidden");
    }
    const authNode = qs("workspace-auth-status");
    if (authNode) {
      authNode.textContent = `ล็อกอินเป็น ${user?.display_name || user?.email || "-"} (${role})`;
    }
  } catch (err) {
    setStatus(err.message || "โหลดสิทธิ์ไม่สำเร็จ", true);
    window.location.replace(rolePortalUrl(currentRole()));
  }
}

init();
