import { useCallback, useEffect, useState } from "react";
import { api, authHeaders } from "../api/api";

const initialForm = {
  email: "",
  password: "",
  role: "user",
};

export default function Users({ token }) {
  const [form, setForm] = useState(initialForm);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingRoleId, setUpdatingRoleId] = useState(null);
  const [message, setMessage] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const res = await api.get("/users", { headers: authHeaders(token) });
      const nextItems = Array.isArray(res.data?.items) ? res.data.items : [];
      setItems(nextItems.map((u) => ({ ...u, role: u.role || "user" })));
    } catch (error) {
      setMessage(error.response?.data?.error || error.response?.data?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function onCreateUser(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await api.post("/users", form, { headers: authHeaders(token) });
      setForm(initialForm);
      setMessage("User created");
      fetchUsers();
    } catch (error) {
      setMessage(error.response?.data?.error || error.response?.data?.message || "Create user failed");
    } finally {
      setSaving(false);
    }
  }

  async function onUpdateRole(user) {
    setUpdatingRoleId(user.id);
    setMessage("");

    try {
      await api.patch(
        `/users/${user.id}/role`,
        { role: user.role },
        { headers: authHeaders(token) }
      );
      setMessage("Role updated");
      fetchUsers();
    } catch (error) {
      setMessage(error.response?.data?.error || error.response?.data?.message || "Update role failed");
    } finally {
      setUpdatingRoleId(null);
    }
  }

  async function onDeleteUser(id) {
    const confirmed = window.confirm("Delete this user?");
    if (!confirmed) return;

    setMessage("");

    try {
      await api.delete(`/users/${id}`, { headers: authHeaders(token) });
      setMessage("User deleted");
      fetchUsers();
    } catch (error) {
      setMessage(error.response?.data?.error || error.response?.data?.message || "Delete user failed");
    }
  }

  function onRoleChange(id, role) {
    setItems((prev) => prev.map((u) => (u.id === id ? { ...u, role } : u)));
  }

  return (
    <>
      <section className="admin-card">
        <div className="card-title-row">
          <h2>Create User</h2>
        </div>

        <form className="grid two" onSubmit={onCreateUser}>
          <input
            type="email"
            placeholder="อีเมล"
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
            required
          />
          <input
            type="password"
            placeholder="รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)"
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
            required
          />
          <select
            value={form.role}
            onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <div />
          <button type="submit" className="primary full" disabled={saving}>
            {saving ? "Creating..." : "Create User"}
          </button>
        </form>
      </section>

      <section className="admin-card">
        <div className="card-title-row">
          <h2>Users</h2>
          <button type="button" className="ghost" onClick={fetchUsers} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {items.length === 0 ? (
          <p className="muted">No users found.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((user) => (
                  <tr key={user.id}>
                    <td>{user.id}</td>
                    <td>{user.email}</td>
                    <td>
                      <select value={user.role} onChange={(e) => onRoleChange(user.id, e.target.value)}>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="ghost"
                        disabled={updatingRoleId === user.id}
                        onClick={() => onUpdateRole(user)}
                      >
                        {updatingRoleId === user.id ? "Saving..." : "Save Role"}
                      </button>
                      <button type="button" className="danger" onClick={() => onDeleteUser(user.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {message ? <p className="status">{message}</p> : null}
    </>
  );
}
