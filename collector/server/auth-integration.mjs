export function createCollectorAuthIntegration({
  db,
  jwt,
  backendApiBase,
  parseObjectJson,
  normalizeUserProfilePayload,
  mergeReservedUserProfileFields,
  backendJwtSecret = "",
  backendJwtIssuer = "uboncity-backend",
  collectorBackendJwtAudience = "uboncity-collector",
}) {
  const BACKEND_AUTH_ROLES = new Set(["owner", "admin", "editor", "freelance", "user"]);
  const DIRECTORY_SYNC_STATE_KEY = "collector_user_directory_last_synced_at";

  function extractBearerToken(req) {
    const auth = String(req.header("authorization") || "");
    if (auth.toLowerCase().startsWith("bearer ")) {
      return auth.slice(7).trim();
    }
    return "";
  }

  function normalizeBackendTokenIdentity(decoded = {}) {
    const role = String(decoded.role || "").trim().toLowerCase();
    const email = String(decoded.email || "").trim().toLowerCase();
    const userId = Number(decoded.id || 0);
    const managerBackendUserIdRaw =
      decoded.managed_by_backend_user_id ?? decoded.managed_by_user_id ?? decoded.manager_user_id ?? null;
    const managerBackendUserIdNumber = Number(managerBackendUserIdRaw || 0);
    const managerClaimPresent = Object.prototype.hasOwnProperty.call(decoded || {}, "managed_by_backend_user_id")
      || Object.prototype.hasOwnProperty.call(decoded || {}, "managed_by_user_id")
      || Object.prototype.hasOwnProperty.call(decoded || {}, "manager_user_id");

    if (!BACKEND_AUTH_ROLES.has(role) || !email || !userId) {
      return null;
    }

    return {
      id: userId,
      email,
      display_name: String(decoded.display_name || "").trim() || email,
      role,
      manager_backend_user_id: managerBackendUserIdNumber > 0 ? managerBackendUserIdNumber : null,
      manager_claim_present: Boolean(managerClaimPresent),
    };
  }

  function writeAuthSyncAudit(identity, action, targetUserId, details = null) {
    try {
      db.prepare(
        `
        INSERT INTO audit_logs (actor_email, action, target_type, target_id, details_json)
        VALUES (?, ?, 'user', ?, ?)
      `
      ).run(
        String(identity?.email || "").trim() || "internal@local",
        String(action || "").trim() || "auth.backend_identity_sync",
        targetUserId ? String(targetUserId) : null,
        details ? JSON.stringify(details) : null
      );
    } catch (error) {
      console.error("backend identity audit logging failed", error);
    }
  }

  function buildBackendIdentityProfileJson(existingProfileJson, identity, displayName) {
    const syncedAt = new Date().toISOString();
    const baseProfile = normalizeUserProfilePayload(existingProfileJson, { allowPic: true });
    const merged = mergeReservedUserProfileFields(existingProfileJson, {
      ...baseProfile,
      display_name: baseProfile.display_name || displayName,
    });
    const existingProfile = parseObjectJson(existingProfileJson);
    const existingAuthSync = parseObjectJson(existingProfile?._auth_sync);
    merged._auth_sync = {
      ...existingAuthSync,
      provider: "backend",
      user_id: Number(identity?.id || 0) || null,
      email: String(identity?.email || "").trim().toLowerCase(),
      manager_backend_user_id: Number(identity?.manager_backend_user_id || 0) || null,
      synced_at: syncedAt,
    };
    return JSON.stringify(merged);
  }

  function ensureDirectorySyncStateTable() {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS collector_sync_state (
        state_key TEXT PRIMARY KEY,
        state_value TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `).run();
  }

  function readCollectorDirectoryLastSyncedAt() {
    ensureDirectorySyncStateTable();
    const row = db
      .prepare("SELECT state_value FROM collector_sync_state WHERE state_key=? LIMIT 1")
      .get(DIRECTORY_SYNC_STATE_KEY);
    const value = String(row?.state_value || "").trim();
    return value || null;
  }

  function writeCollectorDirectoryLastSyncedAt(value) {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    ensureDirectorySyncStateTable();
    db.prepare(`
      INSERT INTO collector_sync_state (state_key, state_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(state_key) DO UPDATE SET
        state_value=excluded.state_value,
        updated_at=CURRENT_TIMESTAMP
    `).run(DIRECTORY_SYNC_STATE_KEY, normalized);
  }

  function upsertDirectoryStateForRow(row, { syncedAt, active, role } = {}) {
    const userId = Number(row?.id || 0) || 0;
    if (!userId) return false;
    const baseProfile = parseObjectJson(row?.profile_json);
    const authSync = parseObjectJson(baseProfile?._auth_sync);
    if (String(authSync?.provider || "").trim().toLowerCase() !== "backend") return false;
    const nextAuthSync = {
      ...authSync,
      directory_active: Boolean(active),
      directory_role: String(role || authSync?.directory_role || "").trim().toLowerCase() || null,
      last_directory_sync_at: String(syncedAt || "").trim() || null,
    };
    const nextProfile = {
      ...baseProfile,
      _auth_sync: nextAuthSync,
    };
    const nextProfileJson = JSON.stringify(nextProfile);
    if (String(row?.profile_json || "") === nextProfileJson) return false;
    db.prepare("UPDATE users SET profile_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(nextProfileJson, userId);
    return true;
  }

  function resolveProjectedManagerLocalId(managerBackendUserId) {
    const normalizedManagerBackendUserId = Number(managerBackendUserId || 0) || 0;
    if (!normalizedManagerBackendUserId) return null;

    const candidates = db
      .prepare("SELECT id, profile_json FROM users WHERE profile_json IS NOT NULL")
      .all();

    for (const row of candidates) {
      const profile = parseObjectJson(row?.profile_json);
      const authSync = parseObjectJson(profile?._auth_sync);
      const backendUserId = Number(authSync?.user_id || 0) || 0;
      if (backendUserId === normalizedManagerBackendUserId) {
        return Number(row?.id || 0) || null;
      }
    }

    return null;
  }

  function buildProjectedManagerLocalIdMap() {
    const map = new Map();
    const candidates = db
      .prepare("SELECT id, profile_json FROM users WHERE profile_json IS NOT NULL")
      .all();
    for (const row of candidates) {
      const profile = parseObjectJson(row?.profile_json);
      const authSync = parseObjectJson(profile?._auth_sync);
      const backendUserId = Number(authSync?.user_id || 0) || 0;
      const localUserId = Number(row?.id || 0) || 0;
      if (!backendUserId || !localUserId) continue;
      if (!map.has(backendUserId)) {
        map.set(backendUserId, localUserId);
      }
    }
    return map;
  }

  function resolveCollectorUserForBackendIdentity(identity, options = {}) {
    if (!identity?.email || !BACKEND_AUTH_ROLES.has(String(identity.role || "").trim().toLowerCase())) {
      return null;
    }

    const email = String(identity.email || "").trim().toLowerCase();
    const displayName = String(identity.display_name || "").trim() || email;
    const role = String(identity.role || "").trim().toLowerCase();
    const existing = db
      .prepare("SELECT id, email, display_name, profile_json, managed_by_user_id, role FROM users WHERE email=? LIMIT 1")
      .get(email);

    const managerMap = options?.managerLocalIdByBackendUserId instanceof Map
      ? options.managerLocalIdByBackendUserId
      : null;
    const projectedManagerLocalId = identity.manager_claim_present
      ? (
        managerMap
          ? (managerMap.get(Number(identity.manager_backend_user_id || 0) || 0) || null)
          : resolveProjectedManagerLocalId(identity.manager_backend_user_id)
      )
      : null;

    if (existing) {
      const nextProfileJson = buildBackendIdentityProfileJson(existing.profile_json, identity, displayName);
      const existingRole = String(existing.role || "").trim().toLowerCase();
      const existingDisplayName = String(existing.display_name || "").trim();
      const projectedManagedByUserId = identity.manager_claim_present
        ? (projectedManagerLocalId || null)
        : null;
      const hasChanges =
        existingDisplayName !== displayName
        || existingRole !== role
        || String(existing.profile_json || "") !== nextProfileJson
        || Number(existing.managed_by_user_id || 0) !== Number(projectedManagedByUserId || 0);

      if (hasChanges) {
        db.prepare(
          `
          UPDATE users
          SET display_name=?, profile_json=?, role=?, managed_by_user_id=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `
        ).run(displayName, nextProfileJson, role, projectedManagedByUserId, existing.id);
        writeAuthSyncAudit(identity, "auth.backend_identity_refresh", existing.id, {
          backend_user_id: identity.id,
          email,
          role,
          projected_manager_backend_user_id: identity.manager_backend_user_id || null,
          projected_manager_local_user_id: projectedManagerLocalId || null,
        });
        if (identity.manager_claim_present && identity.manager_backend_user_id && !projectedManagerLocalId) {
          writeAuthSyncAudit(identity, "auth.backend_identity_projection_pending_manager", existing.id, {
            backend_user_id: identity.id,
            manager_backend_user_id: identity.manager_backend_user_id,
          });
        }
      }

      const updatedRow = db
        .prepare("SELECT id, email, display_name, profile_json, managed_by_user_id, role FROM users WHERE id=? LIMIT 1")
        .get(existing.id);
      if (managerMap && updatedRow?.id) {
        managerMap.set(Number(identity.id || 0) || 0, Number(updatedRow.id || 0) || 0);
      }
      if (options?.includeSyncMeta) {
        return {
          row: updatedRow,
          action: hasChanges ? "updated" : "unchanged",
        };
      }
      return updatedRow;
    }

    const profileJson = buildBackendIdentityProfileJson(null, identity, displayName);
    db.prepare(
      `
      INSERT INTO users (email, display_name, profile_json, password_hash, managed_by_user_id, role)
      VALUES (?, ?, ?, '', NULL, ?)
    `
    ).run(email, displayName, profileJson, role);

    const created = db
      .prepare("SELECT id, email, display_name, profile_json, managed_by_user_id, role FROM users WHERE email=? LIMIT 1")
      .get(email);
    if (created) {
      const projectedManagedByUserId = identity.manager_claim_present
        ? (projectedManagerLocalId || null)
        : null;
      if (projectedManagedByUserId !== null) {
        db.prepare("UPDATE users SET managed_by_user_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .run(projectedManagedByUserId, created.id);
      }
      writeAuthSyncAudit(identity, "auth.backend_identity_provisioned", created.id, {
        backend_user_id: identity.id,
        email,
        role,
        projected_manager_backend_user_id: identity.manager_backend_user_id || null,
        projected_manager_local_user_id: projectedManagerLocalId || null,
      });
      if (identity.manager_claim_present && identity.manager_backend_user_id && !projectedManagerLocalId) {
        writeAuthSyncAudit(identity, "auth.backend_identity_projection_pending_manager", created.id, {
          backend_user_id: identity.id,
          manager_backend_user_id: identity.manager_backend_user_id,
        });
      }
    }
    const createdRow = db
      .prepare("SELECT id, email, display_name, profile_json, managed_by_user_id, role FROM users WHERE email=? LIMIT 1")
      .get(email) || null;
    if (managerMap && createdRow?.id) {
      managerMap.set(Number(identity.id || 0) || 0, Number(createdRow.id || 0) || 0);
    }
    if (options?.includeSyncMeta) {
      return {
        row: createdRow,
        action: "created",
      };
    }
    return createdRow;
  }

  function verifyBackendTokenIdentity(token) {
    if (!token || !backendJwtSecret) return null;
    try {
      const decoded = jwt.verify(token, backendJwtSecret, {
        issuer: backendJwtIssuer,
        audience: collectorBackendJwtAudience,
      });
      const identity = normalizeBackendTokenIdentity(decoded);
      if (!identity) return null;
      const collectorUser = resolveCollectorUserForBackendIdentity(identity);
      if (!collectorUser?.id) return null;
      return {
        id: Number(collectorUser.id),
        email: String(collectorUser.email || "").trim().toLowerCase(),
        display_name: String(collectorUser.display_name || "").trim() || identity.email,
        role: String(collectorUser.role || "").trim().toLowerCase(),
        backend_user_id: identity.id,
        auth_source: "backend",
      };
    } catch {
      return null;
    }
  }

  function resolveBackendAuthLoginUrl() {
    const normalizedBase = String(backendApiBase || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(normalizedBase)) return "";
    return `${normalizedBase}/login`;
  }

  function resolveBackendUsersUrl() {
    const normalizedBase = String(backendApiBase || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(normalizedBase)) return "";
    return `${normalizedBase}/users`;
  }

  function normalizeBackendDirectoryIdentity(row = {}) {
    return normalizeBackendTokenIdentity({
      id: row?.id,
      email: row?.email,
      role: row?.role,
      display_name: row?.display_name || row?.email,
      managed_by_backend_user_id: row?.managed_by_user_id,
    });
  }

  function sortBackendDirectoryIdentities(identities = []) {
    const roleWeight = new Map([
      ["owner", 1],
      ["admin", 2],
      ["user", 3],
      ["editor", 4],
      ["freelance", 5],
    ]);
    return identities.slice().sort((left, right) => {
      const leftWeight = roleWeight.get(String(left?.role || "").trim().toLowerCase()) || 99;
      const rightWeight = roleWeight.get(String(right?.role || "").trim().toLowerCase()) || 99;
      if (leftWeight !== rightWeight) return leftWeight - rightWeight;
      return Number(left?.id || 0) - Number(right?.id || 0);
    });
  }

  function markMissingBackendProjectionsInactive(activeBackendUserIds, syncedAt) {
    const activeIds = activeBackendUserIds instanceof Set ? activeBackendUserIds : new Set();
    const rows = db
      .prepare("SELECT id, profile_json FROM users WHERE profile_json IS NOT NULL")
      .all();
    let deactivatedCount = 0;
    for (const row of rows) {
      const profile = parseObjectJson(row?.profile_json);
      const authSync = parseObjectJson(profile?._auth_sync);
      if (String(authSync?.provider || "").trim().toLowerCase() !== "backend") continue;
      const backendUserId = Number(authSync?.user_id || 0) || 0;
      if (!backendUserId || activeIds.has(backendUserId)) continue;
      const changed = upsertDirectoryStateForRow(row, {
        syncedAt,
        active: false,
        role: String(authSync?.directory_role || "").trim().toLowerCase() || null,
      });
      if (changed) deactivatedCount += 1;
    }
    return deactivatedCount;
  }

  async function syncCollectorUsersFromBackendDirectory(token) {
    const backendUsersUrl = resolveBackendUsersUrl();
    if (!backendUsersUrl) {
      return {
        ok: false,
        status: 503,
        error: "Backend users endpoint is not configured",
      };
    }

    let response;
    try {
      response = await fetch(backendUsersUrl, {
        method: "GET",
        headers: {
          authorization: `Bearer ${String(token || "").trim()}`,
        },
      });
    } catch {
      return {
        ok: false,
        status: 503,
        error: "Backend user directory is unavailable",
      };
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: String(payload?.error || "Backend user directory sync failed"),
      };
    }

    const identities = sortBackendDirectoryIdentities(
      (Array.isArray(payload?.items) ? payload.items : [])
        .map((row) => normalizeBackendDirectoryIdentity(row))
        .filter(Boolean)
    );
    const managerLocalIdByBackendUserId = buildProjectedManagerLocalIdMap();
    const syncedAt = new Date().toISOString();
    const activeBackendUserIds = new Set(
      identities.map((identity) => Number(identity?.id || 0) || 0).filter(Boolean)
    );
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    for (const identity of identities) {
      const result = resolveCollectorUserForBackendIdentity(identity, {
        managerLocalIdByBackendUserId,
        includeSyncMeta: true,
      });
      if (!result?.row?.id) {
        failedCount += 1;
        continue;
      }
      const directoryStateChanged = upsertDirectoryStateForRow(result.row, {
        syncedAt,
        active: true,
        role: identity.role,
      });
      if (result.action === "created") createdCount += 1;
      else if (result.action === "updated") updatedCount += 1;
      else if (directoryStateChanged) updatedCount += 1;
    }
    const deactivatedCount = markMissingBackendProjectionsInactive(activeBackendUserIds, syncedAt);
    let freshnessUpdated = false;
    if (failedCount === 0) {
      writeCollectorDirectoryLastSyncedAt(syncedAt);
      freshnessUpdated = true;
    }
    const authoritativeLastSyncedAt = readCollectorDirectoryLastSyncedAt();

    return {
      ok: true,
      backendUserIds: identities.map((identity) => Number(identity.id || 0)).filter(Boolean),
      syncedBackendUserCount: identities.length,
      createdCount,
      updatedCount,
      failedCount,
      deactivatedCount,
      freshnessUpdated,
      lastSyncedAt: authoritativeLastSyncedAt || null,
    };
  }

  async function authenticateViaBackendLogin(email, password) {
    const loginUrl = resolveBackendAuthLoginUrl();
    if (!loginUrl) {
      return {
        ok: false,
        status: 503,
        error: "Backend auth endpoint is not configured",
      };
    }

    let response;
    try {
      response = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(email || "").trim().toLowerCase(),
          password: String(password || ""),
        }),
      });
    } catch {
      return {
        ok: false,
        status: 503,
        error: "Backend auth is unavailable",
      };
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: String(payload?.error || "Backend auth failed"),
      };
    }

    const backendToken = String(payload?.token || "").trim();
    if (!backendToken) {
      return {
        ok: false,
        status: 502,
        error: "Backend auth response missing token",
      };
    }

    const collectorUser = verifyBackendTokenIdentity(backendToken);
    if (!collectorUser?.id) {
      return {
        ok: false,
        status: 401,
        error: "Backend token is not valid for collector",
      };
    }

    return {
      ok: true,
      status: response.status,
      token: backendToken,
      user: collectorUser,
    };
  }

  function requireAuth(req, res, next) {
    const bearerToken = extractBearerToken(req);
    const backendIdentity = verifyBackendTokenIdentity(bearerToken);
    if (backendIdentity) {
      req.authUser = backendIdentity;
      next();
      return;
    }
    res.status(401).json({ error: "Backend authentication is required" });
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.authUser) {
        res.status(401).json({ error: "Not logged in" });
        return;
      }

      const currentRole = String(req.authUser.role || "").toLowerCase();
      if (currentRole === "owner") {
        next();
        return;
      }

      if (!roles.includes(currentRole)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      next();
    };
  }

  function actorEmail(req) {
    return req.authUser?.email || "internal@local";
  }

  return {
    authenticateViaBackendLogin,
    syncCollectorUsersFromBackendDirectory,
    readCollectorDirectoryLastSyncedAt,
    verifyBackendTokenIdentity,
    requireAuth,
    requireRole,
    actorEmail,
  };
}
