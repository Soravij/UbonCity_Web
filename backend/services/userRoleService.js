import pool from "../config/db.js";

let ensurePromise;
const CANONICAL_ROLES = new Set(["owner", "admin", "editor", "freelance", "user"]);
const MANAGED_CONTRIBUTOR_ROLES = new Set(["freelance", "editor"]);

async function checkColumnExists(columnName) {
  const [dbRows] = await pool.query("SELECT DATABASE() AS dbName");
  const dbName = dbRows?.[0]?.dbName;

  if (!dbName) return false;

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.columns
     WHERE table_schema = ?
       AND table_name = 'users'
       AND column_name = ?`,
    [dbName, String(columnName || "")]
  );

  return Number(rows?.[0]?.total || 0) > 0;
}

async function ensureIndexExists(indexName, columnName) {
  const [dbRows] = await pool.query("SELECT DATABASE() AS dbName");
  const dbName = dbRows?.[0]?.dbName;
  if (!dbName) return;

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.statistics
     WHERE table_schema = ?
       AND table_name = 'users'
       AND index_name = ?
       AND column_name = ?`,
    [dbName, String(indexName || ""), String(columnName || "")]
  );

  if (Number(rows?.[0]?.total || 0) > 0) {
    return;
  }

  await pool.query(`CREATE INDEX ${indexName} ON users (${columnName})`);
}

export function parseCanonicalRole(role, fallback = "") {
  const normalized = String(role || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return CANONICAL_ROLES.has(normalized) ? normalized : fallback;
}

export function isManagedContributorRole(role) {
  return MANAGED_CONTRIBUTOR_ROLES.has(parseCanonicalRole(role, ""));
}

function allowedManagerRolesForTargetRole(role) {
  const normalizedRole = parseCanonicalRole(role, "");
  if (normalizedRole === "admin") return new Set(["owner"]);
  if (normalizedRole === "user") return new Set(["owner", "admin"]);
  if (normalizedRole === "editor" || normalizedRole === "freelance") return new Set(["owner", "admin", "user"]);
  return new Set();
}

export function canActorManageTargetRole(actorRole, targetRole) {
  const normalizedActorRole = parseCanonicalRole(actorRole, "");
  const normalizedTargetRole = parseCanonicalRole(targetRole, "");
  if (!normalizedActorRole || !normalizedTargetRole) return false;
  if (normalizedActorRole === "owner") return normalizedTargetRole !== "owner";
  if (normalizedActorRole === "admin") {
    return normalizedTargetRole === "user" || normalizedTargetRole === "editor" || normalizedTargetRole === "freelance";
  }
  if (normalizedActorRole === "user") {
    return normalizedTargetRole === "editor" || normalizedTargetRole === "freelance";
  }
  return false;
}

export async function ensureUserLifecycleColumns() {
  if (ensurePromise) {
    return ensurePromise;
  }

  ensurePromise = (async () => {
    const hasRole = await checkColumnExists("role");
    if (!hasRole) {
      await pool.query("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'");
    }

    const hasManagedBy = await checkColumnExists("managed_by_user_id");
    if (!hasManagedBy) {
      await pool.query("ALTER TABLE users ADD COLUMN managed_by_user_id BIGINT UNSIGNED NULL");
    }

    const hasProfileJson = await checkColumnExists("profile_json");
    if (!hasProfileJson) {
      await pool.query("ALTER TABLE users ADD COLUMN profile_json JSON NULL");
    }

    const hasAvatarPath = await checkColumnExists("avatar_path");
    if (!hasAvatarPath) {
      await pool.query("ALTER TABLE users ADD COLUMN avatar_path VARCHAR(1200) NULL");
    }

    const hasAvatarUpdatedAt = await checkColumnExists("avatar_updated_at");
    if (!hasAvatarUpdatedAt) {
      await pool.query("ALTER TABLE users ADD COLUMN avatar_updated_at TIMESTAMP NULL DEFAULT NULL");
    }

    await ensureIndexExists("idx_users_managed_by_user_id", "managed_by_user_id");
  })();

  return ensurePromise;
}

export async function ensureUserRoleColumn() {
  return ensureUserLifecycleColumns();
}

export async function getUserByIdForLifecycle(userId) {
  const normalizedId = Number(userId || 0);
  if (!normalizedId) return null;
  const [rows] = await pool.query(
    "SELECT id, role, managed_by_user_id FROM users WHERE id=? LIMIT 1",
    [normalizedId]
  );
  return rows?.[0] || null;
}

export async function countManagedUsers(userId, roles = []) {
  const normalizedId = Number(userId || 0);
  if (!normalizedId) return 0;

  const normalizedRoles = Array.isArray(roles)
    ? roles.map((role) => parseCanonicalRole(role, "")).filter(Boolean)
    : [];

  if (!normalizedRoles.length) {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS total FROM users WHERE managed_by_user_id=?",
      [normalizedId]
    );
    return Number(rows?.[0]?.total || 0);
  }

  const placeholders = normalizedRoles.map(() => "?").join(", ");
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM users
     WHERE managed_by_user_id=?
       AND role IN (${placeholders})`,
    [normalizedId, ...normalizedRoles]
  );
  return Number(rows?.[0]?.total || 0);
}

export async function listManagedUsersByManagerIds(managerIds = [], roles = []) {
  const normalizedManagerIds = Array.isArray(managerIds)
    ? managerIds.map((id) => Number(id || 0) || 0).filter((id) => id > 0)
    : [];
  if (!normalizedManagerIds.length) return [];

  const normalizedRoles = Array.isArray(roles)
    ? roles.map((role) => parseCanonicalRole(role, "")).filter(Boolean)
    : [];

  const managerPlaceholders = normalizedManagerIds.map(() => "?").join(", ");
  const roleClause = normalizedRoles.length
    ? ` AND role IN (${normalizedRoles.map(() => "?").join(", ")})`
    : "";
  const [rows] = await pool.query(
    `SELECT id, role, managed_by_user_id
     FROM users
     WHERE managed_by_user_id IN (${managerPlaceholders})${roleClause}`,
    [...normalizedManagerIds, ...normalizedRoles]
  );
  return Array.isArray(rows) ? rows : [];
}

export async function listAdminScopedUserIds(adminUserId) {
  const normalizedAdminUserId = Number(adminUserId || 0) || 0;
  if (!normalizedAdminUserId) return [];

  const directRows = await listManagedUsersByManagerIds([normalizedAdminUserId], ["user", "editor", "freelance"]);
  const directUserIds = directRows
    .filter((row) => parseCanonicalRole(row?.role, "") === "user")
    .map((row) => Number(row?.id || 0) || 0)
    .filter(Boolean);
  const indirectContributorRows = directUserIds.length
    ? await listManagedUsersByManagerIds(directUserIds, ["editor", "freelance"])
    : [];

  return Array.from(
    new Set(
      [...directRows, ...indirectContributorRows]
        .map((row) => Number(row?.id || 0) || 0)
        .filter(Boolean)
    )
  );
}

export async function listAdminAssignableManagerIds(adminUserId, targetRole) {
  const normalizedAdminUserId = Number(adminUserId || 0) || 0;
  const normalizedTargetRole = parseCanonicalRole(targetRole, "");
  if (!normalizedAdminUserId || !normalizedTargetRole) return [];

  if (normalizedTargetRole === "user") {
    return [normalizedAdminUserId];
  }

  if (normalizedTargetRole === "editor" || normalizedTargetRole === "freelance") {
    const directManagedUsers = await listManagedUsersByManagerIds([normalizedAdminUserId], ["user"]);
    return Array.from(
      new Set(
        [normalizedAdminUserId]
          .concat(directManagedUsers.map((row) => Number(row?.id || 0) || 0))
          .filter(Boolean)
      )
    );
  }

  return [];
}

export async function validateLifecycleTransition({ currentRole, nextRole, userId }) {
  const fromRole = parseCanonicalRole(currentRole, "");
  const toRole = parseCanonicalRole(nextRole, "");
  const normalizedUserId = Number(userId || 0) || 0;

  if (!fromRole || !toRole || !normalizedUserId) {
    return { ok: false, error: "invalid lifecycle transition" };
  }

  if (fromRole === toRole) {
    return { ok: true };
  }

  if (fromRole === "user" && toRole !== "user") {
    const managedDependents = await countManagedUsers(normalizedUserId);
    if (managedDependents > 0) {
      return {
        ok: false,
        error: `cannot change role while managing ${managedDependents} dependent account(s)`,
      };
    }
  }

  if (fromRole === "admin" && toRole !== "admin") {
    const managedDependents = await countManagedUsers(normalizedUserId);
    if (managedDependents > 0) {
      return {
        ok: false,
        error: `cannot change role while managing ${managedDependents} dependent account(s)`,
      };
    }
  }

  return { ok: true };
}

export async function validateManagedByLifecycle(role, managedByUserId) {
  const normalizedRole = parseCanonicalRole(role, "");
  if (!normalizedRole) {
    return { ok: false, error: "invalid role" };
  }

  const managerId = Number(managedByUserId || 0) || null;
  const allowedManagerRoles = allowedManagerRolesForTargetRole(normalizedRole);
  if (!allowedManagerRoles.size) {
    if (managerId) {
      return { ok: false, error: "managed_by_user_id is not allowed for this role" };
    }
    return { ok: true, managedByUserId: null };
  }

  if (!managerId) {
    return { ok: false, error: `managed_by_user_id is required for role=${normalizedRole}` };
  }

  const manager = await getUserByIdForLifecycle(managerId);
  const managerRole = parseCanonicalRole(manager?.role, "");
  if (!manager || !allowedManagerRoles.has(managerRole)) {
    return {
      ok: false,
      error: `managed_by_user_id for role=${normalizedRole} must reference ${Array.from(allowedManagerRoles).join("/")}`,
    };
  }

  return { ok: true, managedByUserId: managerId };
}
