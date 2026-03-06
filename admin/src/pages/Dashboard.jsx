import { useCallback, useEffect, useState } from "react";
import { api, authHeaders } from "../api/api";
import ContentWorkspace from "./ContentWorkspace";
import Settings from "./Settings";
import Users from "./Users";
import Approvals from "./Approvals";

const CATEGORIES = ["attractions", "activities", "hotels", "cafes", "restaurants", "transport"];

function buildMenu(isAdmin, pendingCount = 0) {
  const base = [
    { key: "create-place", label: "สร้างเนื้อหา", path: "/dashboard/places/create" },
    { key: "edit-place", label: "แก้ไขเนื้อหา", path: "/dashboard/places/edit" },
    { key: "settings", label: "ตั้งค่า", path: "/dashboard/settings" },
  ];

  if (!isAdmin) return base;

  return [
    ...base.slice(0, 2),
    { key: "approvals", label: "รอตรวจสอบ", path: "/dashboard/approvals", badge: pendingCount },
    { key: "users", label: "ผู้ใช้งาน", path: "/dashboard/users" },
    ...base.slice(2),
  ];
}

function DashboardSidebar({ activePath, onNavigate, isAdmin, pendingCount }) {
  const menu = buildMenu(isAdmin, pendingCount);

  return (
    <aside className="sidebar">
      <h3>เมนูแอดมิน</h3>
      <div className="sidebar-links">
        {menu.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`side-link ${activePath === item.path ? "active" : ""}`}
            onClick={() => onNavigate(item.path)}
          >
            <span>{item.label}</span>
            {item.badge ? <span className="menu-badge">{item.badge}</span> : null}
          </button>
        ))}
      </div>
    </aside>
  );
}

function DashboardContent({ path, session, onPendingChanged }) {
  if (path === "/dashboard/places/create") {
    return <ContentWorkspace token={session.token} role={session.role} mode="create" />;
  }

  if (path === "/dashboard/places/edit") {
    return <ContentWorkspace token={session.token} role={session.role} mode="edit" />;
  }

  if (path === "/dashboard/approvals" && session.role === "admin") {
    return <Approvals token={session.token} onPendingChanged={onPendingChanged} />;
  }

  if (path === "/dashboard/users" && session.role === "admin") {
    return <Users token={session.token} />;
  }

  if (path === "/dashboard/settings") {
    return <Settings session={session} />;
  }

  return <ContentWorkspace token={session.token} role={session.role} mode="create" />;
}

export default function Dashboard({ session, path, onNavigate, onLogout }) {
  const [pendingCount, setPendingCount] = useState(0);

  const loadPendingCount = useCallback(async () => {
    if (session.role !== "admin") {
      setPendingCount(0);
      return;
    }

    try {
      const headers = authHeaders(session.token);
      const placeResults = await Promise.all(
        CATEGORIES.map((c) =>
          api.get("/places", {
            params: { category: c, lang: "th", include_unapproved: 1 },
            headers,
          })
        )
      );

      const placeCount = placeResults
        .flatMap((res) => (Array.isArray(res.data?.items) ? res.data.items : []))
        .filter((it) => !Number(it.is_approved)).length;

      const eventRes = await api.get("/events", {
        params: { include_unapproved: 1 },
        headers,
      });
      const eventCount = (Array.isArray(eventRes.data?.items) ? eventRes.data.items : []).filter(
        (it) => !Number(it.is_approved)
      ).length;

      setPendingCount(placeCount + eventCount);
    } catch {
      setPendingCount(0);
    }
  }, [session.role, session.token]);

  useEffect(() => {
    loadPendingCount();
  }, [loadPendingCount, path]);

  return (
    <div className="admin-shell">
      <header className="admin-head admin-topbar">
        <div>
          <h1>UbonCity Dashboard</h1>
          <p>
            เข้าสู่ระบบเป็น {session.email || "unknown"} ({session.role})
          </p>
        </div>
        <button type="button" className="ghost" onClick={onLogout}>
          ออกจากระบบ
        </button>
      </header>

      <div className="dashboard-layout">
        <DashboardSidebar
          activePath={path}
          onNavigate={onNavigate}
          isAdmin={session.role === "admin"}
          pendingCount={pendingCount}
        />
        <main className="dashboard-main">
          <DashboardContent path={path} session={session} onPendingChanged={setPendingCount} />
        </main>
      </div>
    </div>
  );
}
