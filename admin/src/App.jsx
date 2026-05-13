import { useEffect, useMemo, useState } from "react";
import "./App.css";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import { api, authHeaders, normalizeToken } from "./api/api";

const SESSION_KEY = "admin_session";
const THEME_PREFERENCE_KEY = "ubon_theme_preference";
const DASHBOARD_PATHS = [
  "/dashboard",
  "/dashboard/places",
  "/dashboard/emergency",
  "/dashboard/delete-content",
  "/dashboard/homepage-curation",
  "/dashboard/approvals",
  "/dashboard/users",
  "/dashboard/settings",
];

const THEME_PREFERENCES = new Set(["light", "dark", "system"]);

function sanitizeThemePreference(value) {
  const text = String(value || "").trim().toLowerCase();
  return THEME_PREFERENCES.has(text) ? text : "system";
}

function readThemePreference() {
  const attr = document.documentElement.getAttribute("data-theme-preference");
  if (attr) return sanitizeThemePreference(attr);
  try {
    return sanitizeThemePreference(localStorage.getItem(THEME_PREFERENCE_KEY));
  } catch {
    return "system";
  }
}

function ThemeModeControl() {
  const [preference, setPreference] = useState(() => readThemePreference());

  function onChange(event) {
    const nextPreference = sanitizeThemePreference(event.target.value);
    setPreference(nextPreference);
    const api = window.__UBON_THEME__;
    if (api && typeof api.setPreference === "function") {
      api.setPreference(nextPreference);
      return;
    }
    document.documentElement.setAttribute("data-theme-preference", nextPreference);
    document.documentElement.setAttribute("data-theme", nextPreference === "system" ? "light" : nextPreference);
  }

  return (
    <div className="theme-mode-control" role="group" aria-label="Theme mode">
      <label htmlFor="theme-mode-select" className="theme-mode-label">
        ธีม
      </label>
      <select
        id="theme-mode-select"
        className="theme-mode-select"
        value={preference}
        onChange={onChange}
        aria-label="เลือกโหมดธีม"
      >
        <option value="system">System</option>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </div>
  );
}

function currentPath() {
  return window.location.pathname || "/login";
}

function navigate(to, replace = false) {
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", to);
}

function getStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      const legacyToken = normalizeToken(localStorage.getItem("admin_token") || "");
      return { token: legacyToken, role: "", email: "" };
    }

    const parsed = JSON.parse(raw);
    return {
      token: normalizeToken(parsed.token || ""),
      role: String(parsed.role || "").trim().toLowerCase(),
      email: parsed.email || "",
    };
  } catch {
    return { token: "", role: "", email: "" };
  }
}

function normalizePath(path, session) {
  const hasToken = Boolean(normalizeToken(session.token));
  const role = String(session.role || "").trim().toLowerCase();
  const isOwner = role === "owner";
  const isAdminLike = role === "admin" || role === "owner";
  const isRoleResolved = Boolean(role);
  const ownerOnlyPaths = new Set([
    "/dashboard/emergency",
    "/dashboard/delete-content",
  ]);
  const defaultPath = isAdminLike ? "/dashboard/approvals" : "/dashboard/settings";

  if (!hasToken) return "/login";
  if (!isRoleResolved) {
    if (path === "/login" || path === "/dashboard" || path === "/dashboard/places") {
      return "/dashboard/approvals";
    }
    return DASHBOARD_PATHS.includes(path) ? path : "/dashboard/approvals";
  }
  if (path === "/login") return defaultPath;
  if (!DASHBOARD_PATHS.includes(path)) return defaultPath;
  if (path === "/dashboard" || path === "/dashboard/places") return defaultPath;
  if (ownerOnlyPaths.has(path) && !isOwner) {
    return defaultPath;
  }
  if (
    (
      path === "/dashboard/users" ||
      path === "/dashboard/approvals" ||
      path === "/dashboard/homepage-curation"
    ) &&
    !isAdminLike
  ) {
    return defaultPath;
  }

  return path;
}

function App() {
  const [session, setSession] = useState(getStoredSession());
  const [path, setPath] = useState(currentPath());

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const token = normalizeToken(session.token);
    if (!token) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await api.get("/me", { headers: authHeaders(token) });
        const role = String(res.data?.role || "").trim().toLowerCase();
        const email = String(res.data?.email || "").trim();
        if (cancelled) return;

        if (!["owner", "admin"].includes(role)) {
          throw new Error("Invalid role");
        }

        const next = { token, role, email };
        localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        setSession(next);
      } catch {
        if (cancelled) return;
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem("admin_token");
        setSession({ token: "", role: "", email: "" });
        navigate("/login", true);
        setPath("/login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session.token]);

  const routedPath = useMemo(() => normalizePath(path, session), [path, session]);

  useEffect(() => {
    if (routedPath !== path) {
      navigate(routedPath, true);
    }
  }, [path, routedPath]);

  function routeTo(nextPath, replace = false) {
    navigate(nextPath, replace);
    setPath(nextPath);
  }

  function handleLoginSuccess(nextSession) {
    const payload = {
      token: normalizeToken(nextSession.token),
      role: String(nextSession.role || "").trim().toLowerCase(),
      email: nextSession.email || "",
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    localStorage.removeItem("admin_token");
    setSession(payload);
    const role = String(payload.role || "").trim().toLowerCase();
    routeTo("/dashboard/approvals", true);
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("admin_token");
    setSession({ token: "", role: "", email: "" });
    routeTo("/login", true);
  }

  if (routedPath === "/login") {
    return (
      <>
        <ThemeModeControl />
        <Login onLoginSuccess={handleLoginSuccess} />
      </>
    );
  }

  if (routedPath.startsWith("/dashboard")) {
    return (
      <>
        <ThemeModeControl />
        <Dashboard session={session} path={routedPath} onNavigate={routeTo} onLogout={handleLogout} />
      </>
    );
  }

  return null;
}

export default App;
