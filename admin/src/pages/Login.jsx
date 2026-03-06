import { useState } from "react";
import { api } from "../api/api";

export default function Login({ onLoginSuccess }) {
  const [auth, setAuth] = useState({ email: "", password: "" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function onLogin(e) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const res = await api.post("/login", auth);
      const token = res.data?.token || "";
      const role = res.data?.role || "user";
      const email = res.data?.email || auth.email;

      if (!token) {
        setMessage("Login failed");
        return;
      }

      onLoginSuccess({ token, role, email });
    } catch (error) {
      setMessage(error.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-shell">
      <header className="admin-head">
        <h1>UbonCity Admin</h1>
        <p>Please login before accessing dashboard pages.</p>
      </header>

      <section className="admin-card">
        <h2>Login</h2>
        <form className="grid two" onSubmit={onLogin}>
          <input
            placeholder="Email"
            type="email"
            value={auth.email}
            onChange={(e) => setAuth((prev) => ({ ...prev, email: e.target.value }))}
            required
          />
          <input
            placeholder="Password"
            type="password"
            value={auth.password}
            onChange={(e) => setAuth((prev) => ({ ...prev, password: e.target.value }))}
            required
          />
          <button type="submit" className="primary full" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
        {message ? <p className="status">{message}</p> : null}
      </section>
    </div>
  );
}
