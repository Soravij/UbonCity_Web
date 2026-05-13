import pool from "../config/db.js";
import bcrypt from "bcryptjs";
import {
  canActorManageTargetRole,
  countManagedUsers,
  ensureUserLifecycleColumns,
  listAdminAssignableManagerIds,
  listAdminScopedUserIds,
  parseCanonicalRole,
  validateLifecycleTransition,
  validateManagedByLifecycle,
} from "../services/userRoleService.js";
import { buildStoredUserProfile, normalizeUserRowProfile } from "../services/userProfileService.js";
import { clearUserAvatar, resolveUserAvatarPublicUrl, storeUserAvatar } from "../services/userAvatarService.js";

function actorRole(req) {
  return String(req.user?.role || "").toLowerCase();
}

function hasOwnField(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

const PROFILE_PATCH_FIELDS = ["display_name", "phone", "email_alt", "line_id"];

function resolveAutoManagerForCreate(req, targetRole) {
  const normalizedActorRole = actorRole(req);
  const normalizedTargetRole = parseCanonicalRole(targetRole, "");
  if (!canActorManageTargetRole(normalizedActorRole, normalizedTargetRole)) {
    return { ok: false, status: 403, error: "actor cannot create this role" };
  }
  return { ok: true, managedByUserId: Number(req.user?.id || 0) || null };
}

function normalizeLifecycleUser(row) {
  if (!row) return null;
  const profile = normalizeUserRowProfile(row);
  return {
    id: Number(row.id || 0),
    email: String(row.email || ""),
    role: String(row.role || "").toLowerCase(),
    managed_by_user_id: row.managed_by_user_id == null ? null : Number(row.managed_by_user_id),
    display_name: profile.display_name,
    phone: profile.phone,
    email_alt: profile.email_alt,
    line_id: profile.line_id,
    avatar_path: String(row.avatar_path || "").trim() || null,
    avatar_url: "",
    avatar_updated_at: row.avatar_updated_at || null,
    profile_json: profile.profile_json,
  };
}

function logLifecycleAudit(req, { action, targetUserId, before = null, after = null, metadata = null }) {
  console.info("[user-lifecycle-audit]", {
    action: String(action || "").trim() || "unknown",
    actor_user_id: Number(req.user?.id || 0) || null,
    actor_email: String(req.user?.email || "").trim() || null,
    target_user_id: Number(targetUserId || 0) || null,
    before,
    after,
    metadata,
    at: new Date().toISOString(),
  });
}

async function countByRole(role) {
  const [rows] = await pool.query("SELECT COUNT(*) AS total FROM users WHERE role=?", [String(role || "").toLowerCase()]);
  return Number(rows?.[0]?.total || 0);
}

function withAvatarUrl(req, user) {
  if (!user) return null;
  return {
    ...user,
    avatar_url: resolveUserAvatarPublicUrl(req, user.avatar_path),
  };
}

function withAvatarUrls(req, users = []) {
  return (Array.isArray(users) ? users : []).map((user) => withAvatarUrl(req, user));
}

async function fetchUserById(req, id) {
  const normalizedId = Number(id || 0) || 0;
  if (!normalizedId) return null;
  const [rows] = await pool.query(
    "SELECT id, email, role, managed_by_user_id, profile_json, avatar_path, avatar_updated_at FROM users WHERE id=? LIMIT 1",
    [normalizedId]
  );
  return withAvatarUrl(req, normalizeLifecycleUser(rows?.[0] || null));
}

async function fetchUsersByIds(req, ids = []) {
  const normalizedIds = Array.isArray(ids)
    ? ids.map((id) => Number(id || 0) || 0).filter((id) => id > 0)
    : [];
  if (!normalizedIds.length) return [];

  const placeholders = normalizedIds.map(() => "?").join(", ");
  const [rows] = await pool.query(
    `SELECT id, email, role, managed_by_user_id, profile_json, avatar_path, avatar_updated_at
     FROM users
     WHERE id IN (${placeholders})
     ORDER BY id DESC`,
    normalizedIds
  );
  const users = Array.isArray(rows) ? rows.map((row) => normalizeLifecycleUser(row)) : [];
  return withAvatarUrls(req, users);
}

async function ensureProfileTargetAccess(req, target) {
  const currentActorRole = actorRole(req);
  const targetUserId = Number(target?.id || 0) || 0;
  const actorUserId = Number(req.user?.id || 0) || 0;
  if (currentActorRole === "owner") {
    return { ok: true };
  }
  if (currentActorRole === "admin") {
    const scopedUserIds = await listAdminScopedUserIds(actorUserId);
    const visibleIds = new Set([actorUserId, ...scopedUserIds]);
    if (!visibleIds.has(targetUserId)) {
      return { ok: false, status: 403, error: "target user is outside admin management scope" };
    }
    return { ok: true };
  }
  if (currentActorRole === "user") {
    if (actorUserId !== targetUserId) {
      return { ok: false, status: 403, error: "user can only update current profile" };
    }
    return { ok: true };
  }
  return { ok: false, status: 403, error: "Forbidden" };
}

async function applyLifecycleUpdate(req, userId, { requestedRole = "", requireRoleField = false, requireManagerField = false } = {}) {
  const normalizedUserId = Number(userId || 0) || 0;
  if (!normalizedUserId) {
    return { ok: false, status: 400, error: "valid user id is required" };
  }

  const current = await fetchUserById(req, normalizedUserId);
  if (!current) {
    return { ok: false, status: 404, error: "User not found" };
  }

  const hasManagedByField = Object.prototype.hasOwnProperty.call(req.body || {}, "managed_by_user_id");
  const hasRoleField = Object.prototype.hasOwnProperty.call(req.body || {}, "role");
  let nextRole = current.role;
  if (hasRoleField || requireRoleField) {
    const parsedRole = parseCanonicalRole(requestedRole, "");
    if (!parsedRole) {
      return { ok: false, status: 400, error: "role must be owner, admin, editor, freelance, or user" };
    }
    nextRole = parsedRole;
  }

  if (requireRoleField && !hasRoleField) {
    return { ok: false, status: 400, error: "role is required" };
  }

  if (!nextRole) {
    return { ok: false, status: 400, error: "role must be owner, admin, editor, freelance, or user" };
  }

  if (requireManagerField && !hasManagedByField) {
    return { ok: false, status: 400, error: "managed_by_user_id is required" };
  }

  if (Number(normalizedUserId) === Number(req.user?.id) && nextRole !== "owner") {
    return { ok: false, status: 400, error: "cannot downgrade your current owner account" };
  }

  if (current.role === "owner" && nextRole !== "owner") {
    const owners = await countByRole("owner");
    if (owners <= 1) {
      return { ok: false, status: 400, error: "cannot remove the last owner" };
    }
  }

  const transitionCheck = await validateLifecycleTransition({
    currentRole: current.role,
    nextRole,
    userId: normalizedUserId,
  });
  if (!transitionCheck.ok) {
    return { ok: false, status: 400, error: transitionCheck.error };
  }

  const managerCandidate = hasManagedByField ? req.body?.managed_by_user_id : current.managed_by_user_id;
  const managedByCheck = await validateManagedByLifecycle(nextRole, managerCandidate);
  if (!managedByCheck.ok) {
    return { ok: false, status: 400, error: managedByCheck.error };
  }

  await pool.query(
    "UPDATE users SET role=?, managed_by_user_id=? WHERE id=?",
    [nextRole, managedByCheck.managedByUserId, normalizedUserId]
  );

  const updated = await fetchUserById(req, normalizedUserId);
  return { ok: true, user: updated, before: current };
}

async function resolveUnifiedLifecyclePatch(req, target, body = {}) {
  const hasRoleField = hasOwnField(body, "role");
  const hasManagedByField = hasOwnField(body, "managed_by_user_id");
  if (!hasRoleField && !hasManagedByField) {
    return { ok: true, shouldUpdate: false, nextRole: target.role, nextManagedByUserId: target.managed_by_user_id };
  }

  const currentActorRole = actorRole(req);
  const targetUserId = Number(target?.id || 0) || 0;
  const actorUserId = Number(req.user?.id || 0) || 0;
  const targetRole = parseCanonicalRole(target?.role, "");

  if (currentActorRole === "admin") {
    if (hasRoleField) {
      return { ok: false, status: 403, error: "admin cannot change role" };
    }
    if (!["user", "editor", "freelance"].includes(targetRole)) {
      return { ok: false, status: 403, error: "admin can only change manager for user/editor/freelance" };
    }
    const scopedUserIds = await listAdminScopedUserIds(actorUserId);
    if (!scopedUserIds.includes(targetUserId)) {
      return { ok: false, status: 403, error: "target user is outside admin management scope" };
    }
    const requestedManagerId = Number(body?.managed_by_user_id || 0) || 0;
    const assignableManagerIds = await listAdminAssignableManagerIds(actorUserId, targetRole);
    if (!requestedManagerId || !assignableManagerIds.includes(requestedManagerId)) {
      return { ok: false, status: 403, error: "requested manager is outside admin assignment scope" };
    }
  } else if (currentActorRole !== "owner") {
    return { ok: false, status: 403, error: "only owner/admin can change lifecycle fields" };
  }

  const nextRole = hasRoleField ? parseCanonicalRole(body?.role, "") : target.role;
  if (!nextRole) {
    return { ok: false, status: 400, error: "role must be owner, admin, editor, freelance, or user" };
  }

  if (Number(targetUserId) === Number(actorUserId) && nextRole !== "owner") {
    return { ok: false, status: 400, error: "cannot downgrade your current owner account" };
  }

  if (target.role === "owner" && nextRole !== "owner") {
    const owners = await countByRole("owner");
    if (owners <= 1) {
      return { ok: false, status: 400, error: "cannot remove the last owner" };
    }
  }

  const transitionCheck = await validateLifecycleTransition({
    currentRole: target.role,
    nextRole,
    userId: targetUserId,
  });
  if (!transitionCheck.ok) {
    return { ok: false, status: 400, error: transitionCheck.error };
  }

  const managerCandidate = hasManagedByField ? body?.managed_by_user_id : target.managed_by_user_id;
  const managedByCheck = await validateManagedByLifecycle(nextRole, managerCandidate);
  if (!managedByCheck.ok) {
    return { ok: false, status: 400, error: managedByCheck.error };
  }

  const nextManagedByUserId = managedByCheck.managedByUserId;
  const lifecycleChanged = nextRole !== target.role || Number(nextManagedByUserId || 0) !== Number(target.managed_by_user_id || 0);

  return {
    ok: true,
    shouldUpdate: lifecycleChanged,
    nextRole,
    nextManagedByUserId,
  };
}

export const getUsers = async (req, res) => {
  try {
    await ensureUserLifecycleColumns();
    const role = actorRole(req);
    let rows = [];
    if (role === "owner") {
      const [allRows] = await pool.query("SELECT id, email, role, managed_by_user_id, profile_json, avatar_path, avatar_updated_at FROM users ORDER BY id DESC");
      rows = withAvatarUrls(req, Array.isArray(allRows) ? allRows.map((row) => normalizeLifecycleUser(row)) : []);
    } else if (role === "admin") {
      const scopedIds = await listAdminScopedUserIds(req.user?.id);
      const visibleIds = Array.from(new Set([Number(req.user?.id || 0) || 0, ...scopedIds].filter(Boolean)));
      rows = await fetchUsersByIds(req, visibleIds);
    } else if (role === "user") {
      const [managedRows] = await pool.query(
        `
          SELECT id, email, role, managed_by_user_id, profile_json, avatar_path, avatar_updated_at
          FROM users
          WHERE managed_by_user_id=? AND role IN ('editor', 'freelance')
          ORDER BY id DESC
        `,
        [Number(req.user?.id || 0) || 0]
      );
      rows = withAvatarUrls(req, Array.isArray(managedRows) ? managedRows.map((row) => normalizeLifecycleUser(row)) : []);
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getUser = async (req, res) => {
  const { id } = req.params;
  try {
    await ensureUserLifecycleColumns();
    const currentActorRole = actorRole(req);
    const targetUserId = Number(id || 0) || 0;
    if (!targetUserId) {
      return res.status(400).json({ error: "valid user id is required" });
    }
    if (currentActorRole === "admin") {
      const scopedUserIds = await listAdminScopedUserIds(req.user?.id);
      const visibleIds = new Set([Number(req.user?.id || 0) || 0, ...scopedUserIds]);
      if (!visibleIds.has(targetUserId)) {
        return res.status(403).json({ error: "target user is outside admin management scope" });
      }
    } else if (currentActorRole !== "owner") {
      return res.status(403).json({ error: "Forbidden" });
    }
    const user = await fetchUserById(req, id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    return res.json({ user });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const createUser = async (req, res) => {
  const { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "password must be at least 6 characters" });
  }

  try {
    await ensureUserLifecycleColumns();

    const [exists] = await pool.query("SELECT id FROM users WHERE email=?", [email]);
    if (exists.length > 0) {
      return res.status(409).json({ error: "email already exists" });
    }

    const requestedRole = parseCanonicalRole(role, "user");
    const actor = actorRole(req);
    const autoManager = resolveAutoManagerForCreate(req, requestedRole);
    if (!autoManager.ok) {
      return res.status(autoManager.status).json({ error: autoManager.error });
    }

    const managedByCheck = await validateManagedByLifecycle(requestedRole, autoManager.managedByUserId);
    if (!managedByCheck.ok) {
      return res.status(400).json({ error: managedByCheck.error });
    }

    const profileJson = buildStoredUserProfile(req.body, {
      fallbackDisplayName: String(email || "").trim(),
    });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (email,password,role,managed_by_user_id,profile_json) VALUES (?,?,?,?,?)",
      [email, hash, requestedRole, managedByCheck.managedByUserId, profileJson]
    );
    const createdId = Number(result?.insertId || 0) || 0;
    try {
      if (String(req.body?.avatar_data_base64 || "").trim()) {
        await storeUserAvatar(req, createdId, {
          dataBase64: req.body?.avatar_data_base64,
          mimeType: req.body?.avatar_mime_type,
        });
      }
    } catch (avatarError) {
      await clearUserAvatar(req, createdId).catch(() => {});
      await pool.query("DELETE FROM users WHERE id=?", [createdId]).catch(() => {});
      const message = String(avatarError?.message || "");
      if (
        message.includes("dataBase64")
        || message.includes("Unsupported image type")
        || message.includes("File too large")
        || message.includes("Invalid image data")
        || message.includes("Image signature")
      ) {
        return res.status(400).json({ error: message || "Invalid avatar payload" });
      }
      return res.status(500).json({ error: "Avatar upload failed" });
    }

    const createdUser = await fetchUserById(req, createdId);
    logLifecycleAudit(req, {
      action: "user.create",
      targetUserId: createdId,
      after: createdUser,
      metadata: {
        actor_role: actor,
        auto_managed_by_user_id: managedByCheck.managedByUserId,
      },
    });

    res.json({ message: "User created", user: createdUser });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateUserRole = async (req, res) => {
  const { id } = req.params;
  const role = parseCanonicalRole(req.body?.role, "");

  if (!role) {
    return res.status(400).json({ error: "role must be owner, admin, editor, freelance, or user" });
  }

  if (actorRole(req) !== "owner") {
    return res.status(403).json({ error: "owner only" });
  }

  try {
    await ensureUserLifecycleColumns();
    const result = await applyLifecycleUpdate(req, id, {
      requestedRole: req.body?.role,
      requireRoleField: true,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    logLifecycleAudit(req, {
      action: "user.update_role",
      targetUserId: id,
      before: result.before,
      after: result.user,
    });
    return res.json({ message: "Role updated", user: result.user });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const updateUserLifecycle = async (req, res) => {
  const { id } = req.params;
  try {
    await ensureUserLifecycleColumns();
    const hasRoleField = Object.prototype.hasOwnProperty.call(req.body || {}, "role");
    const hasManagedByField = Object.prototype.hasOwnProperty.call(req.body || {}, "managed_by_user_id");
    if (!hasRoleField && !hasManagedByField) {
      return res.status(400).json({ error: "at least one of role or managed_by_user_id is required" });
    }
    const result = await applyLifecycleUpdate(req, id, {
      requestedRole: req.body?.role,
      requireRoleField: false,
      requireManagerField: false,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    logLifecycleAudit(req, {
      action: "user.update_lifecycle",
      targetUserId: id,
      before: result.before,
      after: result.user,
    });
    return res.json({ message: "Lifecycle updated", user: result.user });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const updateUserManager = async (req, res) => {
  const { id } = req.params;
  try {
    await ensureUserLifecycleColumns();
    const target = await fetchUserById(req, id);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentActorRole = actorRole(req);
    if (currentActorRole !== "owner" && currentActorRole !== "admin") {
      return res.status(403).json({ error: "owner or admin only" });
    }

    if (currentActorRole === "admin") {
      const targetRole = parseCanonicalRole(target.role, "");
      if (!["user", "editor", "freelance"].includes(targetRole)) {
        return res.status(403).json({ error: "admin can only change manager for user/editor/freelance" });
      }
      const scopedUserIds = await listAdminScopedUserIds(req.user?.id);
      if (!scopedUserIds.includes(Number(target.id || 0) || 0)) {
        return res.status(403).json({ error: "target user is outside admin management scope" });
      }
      const requestedManagerId = Number(req.body?.managed_by_user_id || 0) || 0;
      const assignableManagerIds = await listAdminAssignableManagerIds(req.user?.id, targetRole);
      if (!requestedManagerId || !assignableManagerIds.includes(requestedManagerId)) {
        return res.status(403).json({ error: "requested manager is outside admin assignment scope" });
      }
    }

    const result = await applyLifecycleUpdate(req, id, {
      requestedRole: "",
      requireRoleField: false,
      requireManagerField: true,
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    logLifecycleAudit(req, {
      action: "user.update_manager",
      targetUserId: id,
      before: result.before,
      after: result.user,
    });
    return res.json({ message: "Manager updated", user: result.user });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const updateUserProfile = async (req, res) => {
  const { id } = req.params;
  try {
    await ensureUserLifecycleColumns();
    const target = await fetchUserById(req, id);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    const access = await ensureProfileTargetAccess(req, target);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const targetUserId = Number(target.id || 0) || 0;

    const nextProfileJson = buildStoredUserProfile(req.body, {
      existingProfileJson: target.profile_json,
      fallbackDisplayName: target.email,
    });
    await pool.query("UPDATE users SET profile_json=? WHERE id=?", [nextProfileJson, targetUserId]);
    try {
      if (String(req.body?.avatar_data_base64 || "").trim()) {
        await storeUserAvatar(req, targetUserId, {
          dataBase64: req.body?.avatar_data_base64,
          mimeType: req.body?.avatar_mime_type,
        });
      } else if (req.body?.avatar_clear) {
        await clearUserAvatar(req, targetUserId);
      }
    } catch (avatarError) {
      await pool.query("UPDATE users SET profile_json=? WHERE id=?", [JSON.stringify(target.profile_json || {}), targetUserId]).catch(() => {});
      const message = String(avatarError?.message || "");
      if (
        message.includes("dataBase64")
        || message.includes("Unsupported image type")
        || message.includes("File too large")
        || message.includes("Invalid image data")
        || message.includes("Image signature")
      ) {
        return res.status(400).json({ error: message || "Invalid avatar payload" });
      }
      return res.status(500).json({ error: "Avatar update failed" });
    }

    const updated = await fetchUserById(req, targetUserId);
    logLifecycleAudit(req, {
      action: "user.update_profile",
      targetUserId,
      before: target,
      after: updated,
    });
    return res.json({ message: "Profile updated", user: updated });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const applyUserChanges = async (req, res) => {
  const { id } = req.params;
  try {
    await ensureUserLifecycleColumns();
    const target = await fetchUserById(req, id);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    const body = req.body || {};
    const hasProfilePatch = PROFILE_PATCH_FIELDS.some((field) => hasOwnField(body, field));
    const hasAvatarSet = String(body?.avatar_data_base64 || "").trim().length > 0;
    const hasAvatarClear = Boolean(body?.avatar_clear) && !hasAvatarSet;
    const hasAvatarPatch = hasAvatarSet || hasAvatarClear;
    const hasLifecyclePatch = hasOwnField(body, "role") || hasOwnField(body, "managed_by_user_id");

    if (!hasProfilePatch && !hasAvatarPatch && !hasLifecyclePatch) {
      return res.status(400).json({ error: "at least one mutable field is required" });
    }

    if (hasProfilePatch || hasAvatarPatch) {
      const profileAccess = await ensureProfileTargetAccess(req, target);
      if (!profileAccess.ok) {
        return res.status(profileAccess.status).json({ error: profileAccess.error });
      }
    }

    const lifecyclePatch = await resolveUnifiedLifecyclePatch(req, target, body);
    if (!lifecyclePatch.ok) {
      return res.status(lifecyclePatch.status).json({ error: lifecyclePatch.error });
    }

    const targetUserId = Number(target.id || 0) || 0;
    const beforeProfileJsonText = JSON.stringify(target.profile_json || {});
    const beforeRole = target.role;
    const beforeManagedByUserId = target.managed_by_user_id;
    const nextProfileJsonText = hasProfilePatch
      ? buildStoredUserProfile(body, {
          existingProfileJson: target.profile_json,
          fallbackDisplayName: target.email,
        })
      : beforeProfileJsonText;

    const shouldUpdateDbCore = lifecyclePatch.shouldUpdate || hasProfilePatch;
    if (shouldUpdateDbCore) {
      await pool.query(
        "UPDATE users SET role=?, managed_by_user_id=?, profile_json=? WHERE id=?",
        [lifecyclePatch.nextRole, lifecyclePatch.nextManagedByUserId, nextProfileJsonText, targetUserId]
      );
    }

    try {
      if (hasAvatarSet) {
        await storeUserAvatar(req, targetUserId, {
          dataBase64: body?.avatar_data_base64,
          mimeType: body?.avatar_mime_type,
        });
      } else if (hasAvatarClear) {
        await clearUserAvatar(req, targetUserId);
      }
    } catch (avatarError) {
      if (shouldUpdateDbCore) {
        await pool.query(
          "UPDATE users SET role=?, managed_by_user_id=?, profile_json=? WHERE id=?",
          [beforeRole, beforeManagedByUserId, beforeProfileJsonText, targetUserId]
        ).catch(() => {});
      }
      const message = String(avatarError?.message || "");
      if (
        message.includes("dataBase64")
        || message.includes("Unsupported image type")
        || message.includes("File too large")
        || message.includes("Invalid image data")
        || message.includes("Image signature")
      ) {
        return res.status(400).json({ error: message || "Invalid avatar payload" });
      }
      return res.status(500).json({ error: "Avatar update failed" });
    }

    const updated = await fetchUserById(req, targetUserId);
    logLifecycleAudit(req, {
      action: "user.apply_changes",
      targetUserId,
      before: target,
      after: updated,
      metadata: {
        profile_changed: hasProfilePatch,
        avatar_changed: hasAvatarPatch,
        lifecycle_changed: lifecyclePatch.shouldUpdate,
      },
    });
    return res.json({ message: "Changes applied", user: updated });
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const uploadUserAvatar = async (req, res) => {
  try {
    const target = await fetchUserById(req, req.params.id);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }
    const access = await ensureProfileTargetAccess(req, target);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const avatar = await storeUserAvatar(req, target.id, {
      dataBase64: req.body?.dataBase64,
      mimeType: req.body?.mimeType,
    });
    logLifecycleAudit(req, {
      action: "user.upload_avatar",
      targetUserId: Number(target.id || 0) || null,
      metadata: {
        avatar_path: avatar.avatar_path,
        mime_type: avatar.mime_type,
      },
    });
    return res.status(201).json(avatar);
  } catch (err) {
    const message = String(err?.message || "");
    if (
      message.includes("dataBase64")
      || message.includes("Unsupported image type")
      || message.includes("File too large")
      || message.includes("Invalid image data")
      || message.includes("Image signature")
    ) {
      return res.status(400).json({ error: message || "Invalid upload payload" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteUserAvatar = async (req, res) => {
  try {
    const target = await fetchUserById(req, req.params.id);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }
    const access = await ensureProfileTargetAccess(req, target);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const result = await clearUserAvatar(req, target.id);
    logLifecycleAudit(req, {
      action: "user.delete_avatar",
      targetUserId: Number(target.id || 0) || null,
      metadata: {
        previous_avatar_path: target.avatar_path || null,
      },
    });
    return res.json(result);
  } catch {
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteUser = async (req, res) => {
  const { id } = req.params;

  if (Number(id) === Number(req.user?.id)) {
    return res.status(400).json({ error: "cannot delete current logged in user" });
  }

  if (actorRole(req) !== "owner") {
    return res.status(403).json({ error: "owner only" });
  }

  try {
    await ensureUserLifecycleColumns();

    const target = await fetchUserById(req, id);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    const targetRole = target.role;
    if (targetRole === "owner") {
      const owners = await countByRole("owner");
      if (owners <= 1) {
        return res.status(400).json({ error: "cannot delete the last owner" });
      }
    }

    const managedDependents = await countManagedUsers(id);
    if (managedDependents > 0) {
      if (targetRole === "user") {
        return res.status(400).json({ error: `cannot delete user while managing ${managedDependents} dependent account(s)` });
      }
      if (targetRole === "admin") {
        return res.status(400).json({ error: `cannot delete admin while managing ${managedDependents} dependent account(s)` });
      }
      return res.status(400).json({ error: `cannot delete user while ${managedDependents} dependent account(s) still reference it` });
    }

    if (target.avatar_path) {
      await clearUserAvatar(req, id);
    }
    await pool.query("DELETE FROM users WHERE id=?", [id]);
    logLifecycleAudit(req, {
      action: "user.delete",
      targetUserId: id,
      before: target,
      after: null,
    });
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};
