import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, authHeaders } from "../api/api";
import Settings from "./Settings";
import Users from "./Users";
import Approvals from "./Approvals";
import CtaAnalytics from "./CtaAnalytics";
import HomepageCuration from "./HomepageCuration";
import EmergencyWorkspace from "./EmergencyWorkspace";
import DeleteContentWorkspace from "./DeleteContentWorkspace";

function buildMainMenu(isAdminLike, pendingCount = 0) {
  const base = [{ key: "settings", label: "Settings", path: "/dashboard/settings" }];
  if (!isAdminLike) return base;

  return [
    { key: "approvals", label: "Approvals", path: "/dashboard/approvals", badge: pendingCount },
    { key: "analytics", label: "CTA & Analytics", path: "/dashboard/analytics" },
    { key: "homepage-curation", label: "Homepage Curation", path: "/dashboard/homepage-curation" },
    { key: "users", label: "Users", path: "/dashboard/users" },
    ...base,
  ];
}

function DashboardContent({ path, session, onPendingChanged, onNavigate }) {
  const isOwner = session.role === "owner";
  const isAdminLike = session.role === "admin" || session.role === "owner";

  if (path === "/dashboard/emergency" && isOwner) {
    return <EmergencyWorkspace token={session.token} role={session.role} />;
  }

  if (path === "/dashboard/approvals" && isAdminLike) {
    return <Approvals token={session.token} onPendingChanged={onPendingChanged} onNavigate={onNavigate} />;
  }

  if (path === "/dashboard/analytics" && isAdminLike) {
    return <CtaAnalytics token={session.token} />;
  }

  if (path === "/dashboard/homepage-curation" && isAdminLike) {
    return <HomepageCuration token={session.token} />;
  }

  if (path === "/dashboard/users" && isAdminLike) {
    return <Users token={session.token} role={session.role} />;
  }

  if (path === "/dashboard/delete-content" && isOwner) {
    return <DeleteContentWorkspace token={session.token} role={session.role} />;
  }

  if (path === "/dashboard/settings") {
    return <Settings session={session} />;
  }

  return isAdminLike ? <Approvals token={session.token} onPendingChanged={onPendingChanged} onNavigate={onNavigate} /> : <Settings session={session} />;
}

export default function Dashboard({ session, path, onNavigate, onLogout }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [ownerToolsOpen, setOwnerToolsOpen] = useState(false);
  const ownerToolsMenuRef = useRef(null);
  const isOwner = session.role === "owner";
  const isAdminLike = session.role === "admin" || session.role === "owner";
  const showOwnerToolsTrigger =
    isOwner &&
    path !== "/dashboard/emergency" &&
    path !== "/dashboard/delete-content";
  const mainMenu = useMemo(() => buildMainMenu(isAdminLike, pendingCount), [isAdminLike, pendingCount]);
  const ownerTools = isOwner
    ? [
        { key: "owner-emergency", label: "Emergency", path: "/dashboard/emergency" },
        { key: "owner-delete-content", label: "Delete Content", path: "/dashboard/delete-content" },
      ]
    : [];

  const loadPendingCount = useCallback(async () => {
    if (!isAdminLike) return;

    try {
      const res = await api.get("/collector-import-reviews", {
        params: { status: "pending", source_system: "collector-app", limit: 1, offset: 0 },
        headers: authHeaders(session.token),
      });
      const pending = Number(res.data?.status_counts?.pending || 0) || 0;
      setPendingCount(pending);
    } catch {
      setPendingCount(0);
    }
  }, [isAdminLike, session.token]);

  useEffect(() => {
    if (!isAdminLike) {
      queueMicrotask(() => setPendingCount(0));
      return;
    }
    const timer = setTimeout(() => {
      void loadPendingCount();
    }, 0);
    return () => clearTimeout(timer);
  }, [isAdminLike, loadPendingCount, path]);

  useEffect(() => {
    setOwnerToolsOpen(false);
  }, [path]);

  useEffect(() => {
    if (!ownerToolsOpen) return;

    function handleOutsidePointerDown(event) {
      if (!ownerToolsMenuRef.current) return;
      if (!ownerToolsMenuRef.current.contains(event.target)) {
        setOwnerToolsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOwnerToolsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsidePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [ownerToolsOpen]);

  return (
    <div className="admin-shell">
      <header className="admin-head admin-topbar">
        <div>
          <h1>UbonCity Dashboard</h1>
          <p>
            Signed in as {session.email || "unknown"} ({session.role})
          </p>
        </div>
        <button type="button" className="ghost" onClick={onLogout}>
          Logout
        </button>
      </header>

      <nav className="admin-navbar" aria-label="Dashboard navigation">
        <div className="admin-nav-links">
          {mainMenu.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`admin-nav-link ${path === item.path ? "active" : ""}`}
              onClick={() => onNavigate(item.path)}
            >
              <span>{item.label}</span>
              {item.badge ? <span className="menu-badge">{item.badge}</span> : null}
            </button>
          ))}
        </div>

        {isOwner ? (
          <div className="owner-tools-menu" ref={ownerToolsMenuRef}>
            {showOwnerToolsTrigger ? (
              <>
                <button
                  type="button"
                  className={`admin-nav-link owner-tools-trigger ${ownerToolsOpen ? "active" : ""}`}
                  onClick={() => {
                    if (!isOwner) return;
                    setOwnerToolsOpen((prev) => !prev);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={ownerToolsOpen ? "true" : "false"}
                >
                  Owner Tools
                </button>
                {ownerToolsOpen ? (
                  <div className="owner-tools-dropdown" role="menu">
                    {ownerTools.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        className={`owner-tools-item ${path === item.path ? "active" : ""}`}
                        onClick={() => {
                          setOwnerToolsOpen(false);
                          onNavigate(item.path);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <span className="owner-tools-placeholder" aria-hidden="true">
                Owner Tools
              </span>
            )}
          </div>
        ) : null}
      </nav>

      <main className="dashboard-main">
        <DashboardContent path={path} session={session} onPendingChanged={setPendingCount} onNavigate={onNavigate} />
      </main>
    </div>
  );
}
