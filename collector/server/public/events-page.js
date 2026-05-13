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

function currentRole() {
  return String(state.user?.role || "").trim().toLowerCase();
}

function rolePortalUrl(role = currentRole()) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "editor") return "/editor-home.html";
  if (normalizedRole === "freelance") return "/freelance-home.html";
  return "/";
}

function redirectToLanding() {
  window.location.replace("/");
}

function isPrivilegedEventUser() {
  const role = currentRole();
  return role === "owner" || role === "admin" || role === "user";
}

function setAuthStatus(message) {
  const node = qs("workspace-auth-status");
  if (!node) return;
  node.textContent = String(message || "").trim();
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

async function loadPage() {
  const me = await api("/api/auth/me");
  state.user = me?.user || null;
  if (!isPrivilegedEventUser()) {
    window.location.replace(rolePortalUrl(currentRole()));
    return;
  }
  applyAuthUI();
  setAuthStatus(`เข้าสู่ระบบเป็น ${state.user?.display_name || state.user?.email || "-"} (${currentRole()})`);
}

function wire() {
  qs("btn-back-home")?.addEventListener("click", () => {
    window.location.href = "/";
  });
  qs("btn-open-events-manager")?.addEventListener("click", () => {
    window.location.href = "/events-manager.html";
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
      if (!isPrivilegedEventUser()) {
        window.location.replace(rolePortalUrl(currentRole()));
        return;
      }
      applyAuthUI();
      setAuthStatus(`เข้าสู่ระบบเป็น ${state.user?.display_name || state.user?.email || "-"} (${currentRole()})`);
      setBanner("");
    } catch (error) {
      setBanner(`ตรวจสิทธิ์ไม่สำเร็จ: ${error?.message || "เข้าสู่ระบบไม่สำเร็จ"}`, "error");
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
}

wire();
if (!state.token) {
  applyAuthUI();
  setAuthStatus("ยังไม่ได้เข้าสู่ระบบ");
} else {
  loadPage().catch((err) => {
    syncToken("");
    state.user = null;
    applyAuthUI();
    setAuthStatus("ยังไม่ได้เข้าสู่ระบบ");
    setBanner(`ตรวจสิทธิ์ไม่สำเร็จ: ${err.message || "โหลดสิทธิ์ไม่สำเร็จ"}`, "error");
  });
}
