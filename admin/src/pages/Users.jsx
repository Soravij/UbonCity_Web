import { useCallback, useEffect, useMemo, useState } from "react";
import { api, authHeaders } from "../api/api";
import ProfileImageField from "../components/ProfileImageField";

const initialForm = {
  email: "",
  password: "",
  role: "user",
  display_name: "",
  phone: "",
  email_alt: "",
  line_id: "",
  avatar_key: "",
  avatar_preview_url: "",
  avatar_data_base64: "",
  avatar_mime_type: "",
  avatar_dirty: false,
};

const ROLE_OPTIONS = [
  { value: "user", label: "User" },
  { value: "editor", label: "Editor" },
  { value: "freelance", label: "Freelance" },
  { value: "admin", label: "Admin" },
];

function normalizeRole(value, fallback = "user") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

function parsePositiveInt(value) {
  const num = Number(String(value ?? "").trim());
  if (!Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) return null;
  return num;
}

function getAllowedCreateRoles(actorRole) {
  const normalizedActorRole = normalizeRole(actorRole, "user");
  if (normalizedActorRole === "owner") return ROLE_OPTIONS;
  if (normalizedActorRole === "admin") {
    return ROLE_OPTIONS.filter((option) => option.value === "user" || option.value === "editor" || option.value === "freelance");
  }
  if (normalizedActorRole === "user") {
    return ROLE_OPTIONS.filter((option) => option.value === "editor" || option.value === "freelance");
  }
  return [];
}

function getManagerRoleForTargetRole(role) {
  const normalizedRole = normalizeRole(role, "");
  if (normalizedRole === "admin") return "owner";
  if (normalizedRole === "user") return "owner/admin";
  if (normalizedRole === "editor" || normalizedRole === "freelance") return "owner/admin/user";
  return "";
}

function getRowManagerOptions(items, targetRole) {
  const normalizedRole = normalizeRole(targetRole, "");
  return (Array.isArray(items) ? items : []).filter((user) => {
    const managerRole = normalizeRole(user?.role, "");
    if (normalizedRole === "admin") return managerRole === "owner";
    if (normalizedRole === "user") return managerRole === "owner" || managerRole === "admin";
    if (normalizedRole === "editor" || normalizedRole === "freelance") {
      return managerRole === "owner" || managerRole === "admin" || managerRole === "user";
    }
    return false;
  });
}

function getManagerLabel(user, items) {
  const managedById = Number(user?.managed_by_user_id || 0) || 0;
  if (!managedById) return "-";
  const manager = (Array.isArray(items) ? items : []).find((candidate) => Number(candidate?.id || 0) === managedById);
  if (!manager) return `#${managedById}`;
  return `${manager.display_name || manager.email} (#${manager.id})`;
}

function canAdminEditManager(actorRole, user) {
  const normalizedActorRole = normalizeRole(actorRole, "user");
  if (normalizedActorRole === "owner") return true;
  if (normalizedActorRole !== "admin") return false;
  const targetRole = normalizeRole(user?.role, "");
  return targetRole === "user" || targetRole === "editor" || targetRole === "freelance";
}

function normalizeUserRow(user = {}) {
  const avatarUrl = String(user.avatar_url || "").trim();
  const avatarPath = String(user.avatar_path || "").trim();
  const normalizedRole = normalizeRole(user.role, "user");
  const managedByUserIdValue = user.managed_by_user_id == null ? "" : String(user.managed_by_user_id);
  return {
    ...user,
    role: normalizedRole,
    original_role: normalizedRole,
    managed_by_user_id: user.managed_by_user_id == null ? null : Number(user.managed_by_user_id),
    managed_by_user_id_input: managedByUserIdValue,
    original_managed_by_user_id_input: managedByUserIdValue,
    display_name: String(user.display_name || user.email || "").trim(),
    phone: String(user.phone || "").trim(),
    email_alt: String(user.email_alt || "").trim(),
    line_id: String(user.line_id || "").trim(),
    avatar_path: avatarPath || null,
    avatar_updated_at: user.avatar_updated_at || null,
    avatar_key: avatarUrl || avatarPath || "",
    avatar_url: avatarUrl,
    avatar_preview_url: avatarUrl,
    avatar_data_base64: "",
    avatar_mime_type: "",
    avatar_dirty: false,
  };
}

export default function Users({ token, role = "user" }) {
  const [form, setForm] = useState(initialForm);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applyingUserId, setApplyingUserId] = useState(null);
  const [message, setMessage] = useState("");

  const actorRole = useMemo(() => normalizeRole(role, "user"), [role]);
  const isOwner = actorRole === "owner";
  const createRoleOptions = useMemo(() => getAllowedCreateRoles(actorRole), [actorRole]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const res = await api.get("/users", { headers: authHeaders(token) });
      const nextItems = Array.isArray(res.data?.items) ? res.data.items : [];
      setItems(nextItems.map((u) => normalizeUserRow(u)));
    } catch (error) {
      setMessage(error.response?.data?.error || error.response?.data?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (!createRoleOptions.some((option) => option.value === form.role)) {
      setForm((prev) => ({
        ...prev,
        role: createRoleOptions[0]?.value || "user",
      }));
    }
  }, [createRoleOptions, form.role]);

  async function onCreateUser(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const payload = {
        email: String(form.email || "").trim(),
        password: String(form.password || ""),
        role: normalizeRole(form.role, "user"),
        display_name: String(form.display_name || "").trim(),
        phone: String(form.phone || "").trim(),
        email_alt: String(form.email_alt || "").trim(),
        line_id: String(form.line_id || "").trim(),
        avatar_data_base64: String(form.avatar_data_base64 || ""),
        avatar_mime_type: String(form.avatar_mime_type || ""),
      };
      await api.post("/users", payload, { headers: authHeaders(token) });
      setForm({
        ...initialForm,
        role: createRoleOptions[0]?.value || "user",
      });
      setMessage("User created");
      await fetchUsers();
    } catch (error) {
      setMessage(error.response?.data?.error || error.response?.data?.message || "Create user failed");
    } finally {
      setSaving(false);
    }
  }

  async function onApplyChanges(user) {
    const canApply = isOwner || actorRole === "admin";
    if (!canApply) {
      setMessage("You cannot apply changes for this user");
      return;
    }

    setApplyingUserId(user.id);
    setMessage("");

    try {
      const payload = {
        display_name: String(user.display_name || "").trim(),
        phone: String(user.phone || "").trim(),
        email_alt: String(user.email_alt || "").trim(),
        line_id: String(user.line_id || "").trim(),
        avatar_data_base64: String(user.avatar_data_base64 || ""),
        avatar_mime_type: String(user.avatar_mime_type || ""),
        avatar_clear: Boolean(
          user.avatar_dirty
          && !String(user.avatar_data_base64 || "").trim()
          && (String(user.avatar_path || "").trim() || String(user.avatar_url || "").trim())
        ),
      };

      const roleChanged = normalizeRole(user.role, "user") !== normalizeRole(user.original_role, "user");
      const managerChanged = String(user.managed_by_user_id_input || "") !== String(user.original_managed_by_user_id_input || "");

      if (isOwner) {
        if (roleChanged) {
          payload.role = user.role;
        }
        if (roleChanged || managerChanged) {
          payload.managed_by_user_id = parsePositiveInt(user.managed_by_user_id_input);
        }
      } else if (canAdminEditManager(actorRole, user) && managerChanged) {
        payload.managed_by_user_id = parsePositiveInt(user.managed_by_user_id_input);
      }

      await api.patch(`/users/${user.id}`, payload, { headers: authHeaders(token) });
      setMessage("Changes applied");
      await fetchUsers();
    } catch (error) {
      setMessage(error.response?.data?.error || error.response?.data?.message || "Apply changes failed");
    } finally {
      setApplyingUserId(null);
    }
  }

  async function onDeleteUser(id) {
    if (!isOwner) {
      setMessage("Only owner can delete users");
      return;
    }

    const confirmed = window.confirm("Delete this user?");
    if (!confirmed) return;

    setMessage("");

    try {
      await api.delete(`/users/${id}`, { headers: authHeaders(token) });
      setMessage("User deleted");
      await fetchUsers();
    } catch (error) {
      setMessage(error.response?.data?.error || error.response?.data?.message || "Delete user failed");
    }
  }

  function onRoleChange(id, nextRole) {
    setItems((prev) =>
      prev.map((u) => {
        if (u.id !== id) return u;
        const normalizedNextRole = normalizeRole(nextRole, "user");
        const managerOptions = getRowManagerOptions(prev, normalizedNextRole);
        const nextManagerValue = managerOptions.some((option) => String(option.id) === String(u.managed_by_user_id_input))
          ? u.managed_by_user_id_input
          : "";
        return {
          ...u,
          role: normalizedNextRole,
          managed_by_user_id_input: nextManagerValue,
        };
      })
    );
  }

  function onManagerChange(id, nextValue) {
    setItems((prev) =>
      prev.map((u) =>
        u.id === id
          ? {
              ...u,
              managed_by_user_id_input: String(nextValue ?? ""),
            }
          : u
      )
    );
  }

  function onProfileFieldChange(id, field, value) {
    setItems((prev) =>
      prev.map((u) =>
        u.id === id
          ? {
              ...u,
              [field]: value,
            }
          : u
      )
    );
  }

  return (
    <>
      <section className="admin-card">
        <div className="card-title-row">
          <h2>Create User</h2>
        </div>

        <form className="grid two users-create-form" onSubmit={onCreateUser}>
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
            required
          />
          <input
            type="password"
            placeholder="Password (minimum 6 characters)"
            value={form.password}
            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
            required
          />
          <input
            type="text"
            placeholder="Display name"
            value={form.display_name}
            onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
          />
          <input
            type="email"
            placeholder="Alt email"
            value={form.email_alt}
            onChange={(e) => setForm((prev) => ({ ...prev, email_alt: e.target.value }))}
          />
          <input
            type="text"
            placeholder="Line ID"
            value={form.line_id}
            onChange={(e) => setForm((prev) => ({ ...prev, line_id: e.target.value }))}
          />
          <select
            value={form.role}
            onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
          >
            {createRoleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="full">
            <ProfileImageField
              valueKey={form.avatar_key}
              valuePreviewUrl={form.avatar_preview_url}
              onChange={({ valueKey, previewUrl, dataBase64, mimeType, dirty }) =>
                setForm((prev) => ({
                  ...prev,
                  avatar_key: String(valueKey || ""),
                  avatar_preview_url: String(previewUrl || ""),
                  avatar_data_base64: String(dataBase64 || ""),
                  avatar_mime_type: String(mimeType || ""),
                  avatar_dirty: Boolean(dirty),
                }))
              }
            />
          </div>
          <div className="muted full">
            Creator will become manager automatically. Profile fields follow collector account model.
          </div>
          <button type="submit" className="primary full" disabled={saving || createRoleOptions.length === 0}>
            {saving ? "Creating..." : "Create User"}
          </button>
        </form>

        <p className="muted">
          owner manages all. admin manages user/editor/freelance. user manages editor/freelance.
        </p>
      </section>

      <section className="admin-card">
        <div className="card-title-row">
          <h2>Users</h2>
          <button type="button" className="ghost" onClick={fetchUsers} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {!isOwner ? <p className="muted">Admin can apply profile updates for visible scope and manager updates for user/editor/freelance in scope. Role changes and deletion remain owner-only.</p> : null}

        {items.length === 0 ? (
          <p className="muted">No users found.</p>
        ) : (
          <div className="users-list">
            {items.map((user) => {
              const rowManagerOptions = getRowManagerOptions(items, user.role);
              const managerHelp = getManagerRoleForTargetRole(user.role);
              return (
                <article key={user.id} className="users-item-card">
                  <div className="users-item-head">
                    <div>
                      <p className="users-item-kicker">User #{user.id}</p>
                      <h3>{user.display_name || user.email}</h3>
                      <p className="muted users-email">{user.email}</p>
                    </div>
                    {user.avatar_preview_url ? (
                      <img
                        src={user.avatar_preview_url}
                        alt="Profile preview"
                        className="users-avatar-preview users-avatar-preview-small"
                      />
                    ) : (
                      <div className="users-avatar-fallback">
                        {(user.display_name || user.email || "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                  </div>

                  <div className="users-item-grid">
                    <section className="users-panel">
                      <h4>Profile</h4>
                        <div className="grid users-profile-grid">
                        <input
                          type="text"
                          placeholder="Display name"
                          value={user.display_name}
                          onChange={(e) => onProfileFieldChange(user.id, "display_name", e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="Phone"
                          value={user.phone}
                          onChange={(e) => onProfileFieldChange(user.id, "phone", e.target.value)}
                        />
                        <input
                          type="email"
                          placeholder="Alt email"
                          value={user.email_alt}
                          onChange={(e) => onProfileFieldChange(user.id, "email_alt", e.target.value)}
                        />
                        <input
                          type="text"
                          placeholder="Line ID"
                          value={user.line_id}
                          onChange={(e) => onProfileFieldChange(user.id, "line_id", e.target.value)}
                        />
                        <ProfileImageField
                          compact
                          valueKey={user.avatar_key}
                          valuePreviewUrl={user.avatar_preview_url}
                          onChange={({ valueKey, previewUrl, dataBase64, mimeType, dirty }) => {
                            onProfileFieldChange(user.id, "avatar_key", String(valueKey || ""));
                            onProfileFieldChange(user.id, "avatar_preview_url", String(previewUrl || ""));
                            onProfileFieldChange(user.id, "avatar_data_base64", String(dataBase64 || ""));
                            onProfileFieldChange(user.id, "avatar_mime_type", String(mimeType || ""));
                            onProfileFieldChange(user.id, "avatar_dirty", Boolean(dirty));
                          }}
                        />
                      </div>
                    </section>

                    <section className="users-panel">
                      <h4>Access</h4>
                      <div className="grid users-access-grid">
                        <select
                          value={user.role}
                          onChange={(e) => onRoleChange(user.id, e.target.value)}
                          disabled={!isOwner}
                        >
                          {ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>

                        {isOwner || canAdminEditManager(actorRole, user) ? (
                          <select
                            value={user.managed_by_user_id_input}
                            onChange={(e) => onManagerChange(user.id, e.target.value)}
                            disabled={!managerHelp}
                          >
                            <option value="">{managerHelp ? "Select manager" : "No manager"}</option>
                            {rowManagerOptions.map((option) => (
                              <option key={option.id} value={String(option.id)}>
                                {(option.display_name || option.email)} (#{option.id})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="users-readonly-value">{getManagerLabel(user, items)}</div>
                        )}

                        <div className="muted">
                          {managerHelp ? `Allowed manager: ${managerHelp}` : "This role has no manager"}
                        </div>
                      </div>
                    </section>
                  </div>

                  <div className="users-item-actions">
                    <button
                      type="button"
                      className="ghost"
                      disabled={applyingUserId === user.id || (!isOwner && actorRole !== "admin")}
                      onClick={() => onApplyChanges(user)}
                    >
                      {applyingUserId === user.id ? "Applying..." : "Apply Changes"}
                    </button>
                    <button type="button" className="danger" disabled={!isOwner} onClick={() => onDeleteUser(user.id)}>
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {message ? <p className="status">{message}</p> : null}
    </>
  );
}
