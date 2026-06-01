import { API_BASE_URL } from "../api/api";

export default function Settings({ session }) {
  return (
    <section className="admin-card">
      <h2>Settings</h2>
      <div className="settings-grid">
        <div>
          <p className="muted">API Base URL</p>
          <p>{API_BASE_URL}</p>
        </div>
        <div>
          <p className="muted">Role</p>
          <p>{session.role}</p>
        </div>
        <div>
          <p className="muted">Email</p>
          <p>{session.email || "-"}</p>
        </div>
        <div>
          <p className="muted">Session</p>
          <p>{session.token ? "Authenticated" : "No session"}</p>
        </div>
      </div>
    </section>
  );
}
