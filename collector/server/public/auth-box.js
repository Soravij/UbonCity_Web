const state = {
  token:
    sessionStorage.getItem("collector_token") ||
    localStorage.getItem("collector_token") ||
    "",
  user: null,
};

let statusId = "workspace-auth-status";
let bannerId = "workspace-status";

function qs(id) {
  return document.getElementById(id);
}

function syncToken(token) {
  const normalized = String(token || "").trim();
  state.token = normalized;
  if (normalized) {
    const at = new Date().toISOString();
    sessionStorage.setItem("collector_token", normalized);
    localStorage.setItem("collector_token", normalized);
    sessionStorage.setItem("collector_login_at", at);
    localStorage.setItem("collector_login_at", at);
    return;
  }
  sessionStorage.removeItem("collector_token");
  sessionStorage.removeItem("collector_login_at");
  localStorage.removeItem("collector_token");
  localStorage.removeItem("collector_login_at");
}

function setAuthStatus(message) {
  const node = qs(statusId);
  if (!node) return;
  node.textContent = String(message || "").trim();
}

function setBanner(message = "", isError = false) {
  const node = qs(bannerId);
  if (!node) return;
  node.textContent = String(message || "").trim();
  node.classList.toggle("hidden", !message);
  node.classList.toggle("fail", Boolean(message && isError));
}

function currentRole(user = state.user) {
  return String(user?.role || "").trim().toLowerCase();
}

function rolePortalUrl(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "editor") return "/editor-home.html";
  if (normalizedRole === "freelance") return "/freelance-home.html";
  return "/";
}

function roleAllowed(allowRoles) {
  if (!Array.isArray(allowRoles) || allowRoles.length === 0) return true;
  return allowRoles.map((r) => String(r).toLowerCase()).includes(currentRole());
}

export async function authApi(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (options.body && !(options.body instanceof FormData) && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    throw new Error(payload?.error || text || `HTTP ${res.status}`);
  }
  return payload;
}

function applyAuthUI() {
  const isAuthenticated = Boolean(String(state.token || "").trim() && state.user);
  document.body.classList.toggle("is-authenticated", isAuthenticated);
  document.documentElement.classList.toggle("is-authenticated", isAuthenticated);
  const emailInput = qs("auth-email");
  if (emailInput && state.user?.email) {
    emailInput.value = state.user.email;
  }
}

export function getAuthUser() {
  return state.user;
}

export async function initAuthBox(options = {}) {
  if (options.statusId) statusId = options.statusId;
  if (options.bannerId) bannerId = options.bannerId;
  const onReady = typeof options.onReady === "function" ? options.onReady : null;
  const allowRoles = Array.isArray(options.allowRoles) ? options.allowRoles : null;

  qs("btn-login")?.addEventListener("click", async () => {
    try {
      const email = String(qs("auth-email")?.value || "").trim();
      const password = String(qs("auth-password")?.value || "");
      const result = await authApi("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      syncToken(result?.token || "");
      state.user = result?.user || null;
      if (allowRoles && !roleAllowed(allowRoles)) {
        window.location.replace(rolePortalUrl(currentRole()));
        return;
      }
      applyAuthUI();
      setAuthStatus(
        `เข้าสู่ระบบเป็น ${state.user?.display_name || state.user?.email || "-"} (${currentRole()})`
      );
      setBanner("", false);
      if (onReady) onReady(state.user);
    } catch (err) {
      setBanner(`ตรวจสิทธิ์ไม่สำเร็จ: ${err.message || "เข้าสู่ระบบไม่สำเร็จ"}`, true);
    }
  });

  qs("btn-logout")?.addEventListener("click", async () => {
    try {
      if (state.token) await authApi("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore transport errors and clear local auth state anyway
    }
    syncToken("");
    state.user = null;
    applyAuthUI();
    window.location.replace("/");
  });

  if (!state.token) {
    applyAuthUI();
    setAuthStatus("ยังไม่ได้เข้าสู่ระบบ");
    return null;
  }

  try {
    const me = await authApi("/api/auth/me");
    state.user = me?.user || null;
    if (allowRoles && !roleAllowed(allowRoles)) {
      window.location.replace(rolePortalUrl(currentRole()));
      return null;
    }
    applyAuthUI();
    setAuthStatus(
      `เข้าสู่ระบบเป็น ${state.user?.display_name || state.user?.email || "-"} (${currentRole()})`
    );
    if (onReady) onReady(state.user);
    return state.user;
  } catch (err) {
    syncToken("");
    state.user = null;
    applyAuthUI();
    setAuthStatus("ยังไม่ได้เข้าสู่ระบบ");
    setBanner(`ตรวจสิทธิ์ไม่สำเร็จ: ${err.message || "โหลดสิทธิ์ไม่สำเร็จ"}`, true);
    return null;
  }
}
