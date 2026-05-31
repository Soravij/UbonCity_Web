import { useEffect, useId, useMemo, useState } from "react";
import "./App.css";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import { api, authHeaders, normalizeToken } from "./api/api";

const SESSION_KEY = "admin_session";
const THEME_PREFERENCE_KEY = "ubon_theme_preference";
const DASHBOARD_PATHS = [
  "/dashboard",
  "/dashboard/analytics",
  "/dashboard/places",
  "/dashboard/emergency",
  "/dashboard/delete-content",
  "/dashboard/homepage-curation",
  "/dashboard/approvals",
  "/dashboard/users",
  "/dashboard/settings",
];

const THEME_PREFERENCES = new Set(["light", "dark"]);

function sanitizeThemeMode(value) {
  const text = String(value || "").trim().toLowerCase();
  return THEME_PREFERENCES.has(text) ? text : null;
}

function readThemeMode() {
  const root = document.documentElement;
  const attr = root.getAttribute("data-theme-preference");
  const fromPreference = sanitizeThemeMode(attr);
  if (fromPreference) return fromPreference;
  const fromTheme = sanitizeThemeMode(root.getAttribute("data-theme"));
  if (fromTheme) return fromTheme;
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  try {
    const fromStorage = sanitizeThemeMode(localStorage.getItem(THEME_PREFERENCE_KEY));
    if (fromStorage) return fromStorage;
  } catch {
    return "light";
  }
  return "light";
}

function ThemeModeControl() {
  const toggleId = useId();
  const [mode, setMode] = useState(() => readThemeMode());
  const [zoomFactor, setZoomFactor] = useState(1);

  useEffect(() => {
    function handleThemeChange(event) {
      const nextMode = sanitizeThemeMode(event?.detail?.resolvedTheme) || readThemeMode();
      setMode(nextMode);
    }

    window.addEventListener("ubon-theme-change", handleThemeChange);
    return () => window.removeEventListener("ubon-theme-change", handleThemeChange);
  }, []);

  useEffect(() => {
    const baseDevicePixelRatio = Number(window.devicePixelRatio || 1) || 1;

    function currentViewportScale() {
      const scale = Number(window.visualViewport?.scale || 1);
      return Number.isFinite(scale) && scale > 0 ? scale : 1;
    }

    function syncZoomFactor() {
      const currentDpr = Number(window.devicePixelRatio || baseDevicePixelRatio) || baseDevicePixelRatio;
      const dprRatio = currentDpr / baseDevicePixelRatio;
      const zoom = Math.max(dprRatio, currentViewportScale(), 1);
      setZoomFactor(Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
    }

    syncZoomFactor();
    window.visualViewport?.addEventListener("resize", syncZoomFactor);
    window.visualViewport?.addEventListener("scroll", syncZoomFactor);
    window.addEventListener("resize", syncZoomFactor);
    return () => {
      window.visualViewport?.removeEventListener("resize", syncZoomFactor);
      window.visualViewport?.removeEventListener("scroll", syncZoomFactor);
      window.removeEventListener("resize", syncZoomFactor);
    };
  }, []);

  function onChange(event) {
    const nextMode = event.target.checked ? "dark" : "light";
    setMode(nextMode);
    const api = window.__UBON_THEME__;
    if (api && typeof api.setPreference === "function") {
      api.setPreference(nextMode);
      return;
    }
    document.documentElement.setAttribute("data-theme-preference", nextMode);
    document.documentElement.setAttribute("data-theme", nextMode);
  }

  return (
    <div
      className="theme-mode-control theme-switch-control"
      role="group"
      aria-label="Theme mode"
      style={{ "--theme-zoom-factor": String(zoomFactor) }}
    >
      <label className="switch" htmlFor={toggleId}>
        <input id={toggleId} type="checkbox" checked={mode === "dark"} onChange={onChange} aria-label="Theme mode toggle" />
        <div className="slider round">
          <div className="sun-moon">
            <svg id="moon-dot-1" className="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="moon-dot-2" className="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="moon-dot-3" className="moon-dot" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="light-ray-1" className="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="light-ray-2" className="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="light-ray-3" className="light-ray" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-1" className="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-2" className="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-3" className="cloud-dark" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-4" className="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-5" className="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
            <svg id="cloud-6" className="cloud-light" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" /></svg>
          </div>
          <div className="stars">
            <svg id="star-1" className="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z" /></svg>
            <svg id="star-2" className="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z" /></svg>
            <svg id="star-3" className="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z" /></svg>
            <svg id="star-4" className="star" viewBox="0 0 20 20"><path d="M 0 10 C 10 10,10 10 ,0 10 C 10 10 , 10 10 , 10 20 C 10 10 , 10 10 , 20 10 C 10 10 , 10 10 , 10 0 C 10 10,10 10 ,0 10 Z" /></svg>
          </div>
        </div>
      </label>
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

