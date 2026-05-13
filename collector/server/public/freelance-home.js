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

function setAuthStatus(message) {
  const node = qs("portal-auth-status");
  if (!node) return;
  node.textContent = String(message || "").trim();
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
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return {};
  return res.json();
}

function parsePositiveInt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function workUrl(itemId, assignmentId) {
  const params = new URLSearchParams();
  params.set("tab", "work");
  const normalizedItemId = parsePositiveInt(itemId);
  const normalizedAssignmentId = parsePositiveInt(assignmentId);
  if (normalizedItemId > 0) params.set("item_id", String(normalizedItemId));
  if (normalizedAssignmentId > 0) params.set("assignment_id", String(normalizedAssignmentId));
  return `/?${params.toString()}`;
}

function ensureFreelanceRole() {
  const role = String(state.user?.role || "").trim().toLowerCase();
  if (role !== "freelance") {
    window.location.replace(rolePortalUrl(role));
    return false;
  }
  return true;
}

function landingContextFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    itemId: parsePositiveInt(params.get("item_id")),
    assignmentId: parsePositiveInt(params.get("assignment_id")),
  };
}

function wire() {
  const landingContext = landingContextFromQuery();
  qs("btn-open-work")?.addEventListener("click", () => {
    window.location.assign(workUrl(landingContext.itemId, landingContext.assignmentId));
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
      if (!ensureFreelanceRole()) return;
      applyAuthUI();
      setAuthStatus(`เข้าสู่ระบบเป็น ${state.user?.display_name || state.user?.email || "-"} (freelance)`);
    } catch (error) {
      setAuthStatus(error?.message || "เข้าสู่ระบบไม่สำเร็จ");
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

async function init() {
  wire();
  if (!state.token) {
    applyAuthUI();
    setAuthStatus("ยังไม่ได้เข้าสู่ระบบ");
    return;
  }
  try {
    const result = await api("/api/auth/me");
    state.user = result?.user || null;
    if (!ensureFreelanceRole()) return;
    applyAuthUI();
    setAuthStatus(`เข้าสู่ระบบเป็น ${state.user?.display_name || state.user?.email || "-"} (freelance)`);
  } catch {
    syncToken("");
    state.user = null;
    applyAuthUI();
    setAuthStatus("ยังไม่ได้เข้าสู่ระบบ");
  }
}

init();
