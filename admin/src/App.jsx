import { useEffect, useMemo, useState } from "react";
import "./App.css";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import { normalizeToken } from "./api/api";

const SESSION_KEY = "admin_session";
const DASHBOARD_PATHS = [
  "/dashboard",
  "/dashboard/places",
  "/dashboard/places/create",
  "/dashboard/places/edit",
  "/dashboard/approvals",
  "/dashboard/users",
  "/dashboard/settings",
];

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
      return { token: legacyToken, role: "user", email: "" };
    }

    const parsed = JSON.parse(raw);
    return {
      token: normalizeToken(parsed.token || ""),
      role: parsed.role || "user",
      email: parsed.email || "",
    };
  } catch {
    return { token: "", role: "user", email: "" };
  }
}

function normalizePath(path, session) {
  const hasToken = Boolean(normalizeToken(session.token));
  const isAdmin = session.role === "admin";

  if (!hasToken) return "/login";
  if (path === "/login") return "/dashboard/places/create";
  if (!DASHBOARD_PATHS.includes(path)) return "/dashboard/places/create";
  if (path === "/dashboard" || path === "/dashboard/places") return "/dashboard/places/create";
  if ((path === "/dashboard/users" || path === "/dashboard/approvals") && !isAdmin) {
    return "/dashboard/places/create";
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
      role: nextSession.role || "user",
      email: nextSession.email || "",
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    localStorage.removeItem("admin_token");
    setSession(payload);
    routeTo("/dashboard/places/create", true);
  }

  function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("admin_token");
    setSession({ token: "", role: "user", email: "" });
    routeTo("/login", true);
  }

  if (routedPath === "/login") {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (routedPath.startsWith("/dashboard")) {
    return <Dashboard session={session} path={routedPath} onNavigate={routeTo} onLogout={handleLogout} />;
  }

  return null;
}

export default App;
