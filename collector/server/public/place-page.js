const state = {
  token: sessionStorage.getItem("collector_token") || localStorage.getItem("collector_token") || "",
  user: null,
  loginAt: sessionStorage.getItem("collector_login_at") || localStorage.getItem("collector_login_at") || "",
};

function qs(id) {
  return document.getElementById(id);
}

function applyAuthUI() {
  const isAuthenticated = Boolean(String(state.token || "").trim() && state.user);
  document.body.classList.toggle("is-authenticated", isAuthenticated);
  const emailInput = qs("auth-email");
  if (emailInput && state.user?.email) {
    emailInput.value = state.user.email;
  }
}

function syncToken(token) {
  const normalized = String(token || "").trim();
  state.token = normalized;
  if (normalized) {
    sessionStorage.setItem("collector_token", normalized);
    localStorage.setItem("collector_token", normalized);
    state.loginAt = new Date().toISOString();
    sessionStorage.setItem("collector_login_at", state.loginAt);
    localStorage.setItem("collector_login_at", state.loginAt);
    return;
  }
  state.loginAt = "";
  sessionStorage.removeItem("collector_token");
  sessionStorage.removeItem("collector_login_at");
  localStorage.removeItem("collector_token");
  localStorage.removeItem("collector_login_at");
}

function setStatus(message = "", isError = false) {
  const node = qs("workspace-status");
  if (!node) return;
  node.textContent = String(message || "").trim();
  node.classList.toggle("hidden", !message);
  node.classList.toggle("fail", Boolean(message && isError));
}

function setAuthStatus(message) {
  const node = qs("workspace-auth-status");
  if (!node) return;
  node.textContent = String(message || "").trim();
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

function redirectToLanding() {
  window.location.replace("/");
}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
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

async function init() {
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-place-raw")?.addEventListener("click", () => {
    window.location.href = "/?tab=raw";
  });
  qs("btn-open-place-assignments")?.addEventListener("click", () => {
    window.location.href = "/?tab=handoff";
  });
  qs("btn-open-place-write")?.addEventListener("click", () => {
    window.location.href = "/article-intake.html?scope=place";
  });

  qs("btn-login")?.addEventListener("click", async () => {
    try {
      const email = String(qs("auth-email")?.value || "").trim();
      const password = String(qs("auth-password")?.value || "");
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      syncToken(result?.token || "");
      state.user = result?.user || null;
      const role = currentRole();
      if (role !== "owner" && role !== "admin" && role !== "user") {
        window.location.replace(rolePortalUrl(role));
        return;
      }
      applyAuthUI();
      setAuthStatus(`เข้าสู่ระบบเป็น ${state.user?.display_name || state.user?.email || "-"} (${role})`);
      setStatus("", false);
    } catch (err) {
      setStatus(`ตรวจสิทธิ์ไม่สำเร็จ: ${err.message || "เข้าสู่ระบบไม่สำเร็จ"}`, true);
    }
  });

  qs("btn-logout")?.addEventListener("click", async () => {
    try {
      if (state.token) {
        await api("/api/auth/logout", { method: "POST" });
      }
    } catch {
      // ignore transport errors and clear local auth state anyway
    }
    syncToken("");
    state.user = null;
    applyAuthUI();
    redirectToLanding();
  });

  if (!state.token) {
    applyAuthUI();
    setAuthStatus("ยังไม่ได้เข้าสู่ระบบ");
    return;
  }

  try {
    const me = await api("/api/auth/me");
    const user = me?.user || null;
    state.user = user;
    const role = currentRole(user);
    if (role !== "owner" && role !== "admin" && role !== "user") {
      window.location.replace(rolePortalUrl(role));
      return;
    }
    applyAuthUI();
    setAuthStatus(`เข้าสู่ระบบเป็น ${user?.display_name || user?.email || "-"} (${role})`);
  } catch (err) {
    syncToken("");
    state.user = null;
    applyAuthUI();
    setAuthStatus("ยังไม่ได้เข้าสู่ระบบ");
    setStatus(`ตรวจสิทธิ์ไม่สำเร็จ: ${err.message || "โหลดสิทธิ์ไม่สำเร็จ"}`, true);
  }
}

init();
