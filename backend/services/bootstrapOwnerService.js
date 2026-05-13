import bcrypt from "bcryptjs";
import pool from "../config/db.js";
import { ensureUserLifecycleColumns } from "./userRoleService.js";

function readBootstrapOwnerConfig() {
  const email = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.OWNER_PASSWORD || "");
  return {
    email,
    password,
  };
}

export async function ensureBootstrapOwner() {
  const { email, password } = readBootstrapOwnerConfig();
  if (!email || !password) {
    return { ok: true, skipped: true, reason: "missing_owner_env" };
  }

  if (String(password).length < 6) {
    throw new Error("OWNER_PASSWORD must be at least 6 characters");
  }

  await ensureUserLifecycleColumns();

  const passwordHash = await bcrypt.hash(password, 10);
  const [existingRows] = await pool.query(
    "SELECT id, email, role FROM users WHERE email=? LIMIT 1",
    [email]
  );

  if (Array.isArray(existingRows) && existingRows.length > 0) {
    const existingUser = existingRows[0];
    await pool.query(
      "UPDATE users SET password=?, role='owner', managed_by_user_id=NULL WHERE id=?",
      [passwordHash, Number(existingUser.id || 0) || 0]
    );
    console.info("[auth-bootstrap-owner]", {
      action: "promote_existing_user_to_owner",
      user_id: Number(existingUser.id || 0) || null,
      email,
      at: new Date().toISOString(),
    });
    return {
      ok: true,
      created: false,
      owner_id: Number(existingUser.id || 0) || null,
      owner_email: email,
    };
  }

  const [ownerRows] = await pool.query(
    "SELECT id, email FROM users WHERE role='owner' ORDER BY id ASC LIMIT 1"
  );
  if (Array.isArray(ownerRows) && ownerRows.length > 0) {
    await pool.query(
      "INSERT INTO users (email,password,role,managed_by_user_id) VALUES (?,?,'owner',NULL)",
      [email, passwordHash]
    );
    const [createdRows] = await pool.query(
      "SELECT id, email FROM users WHERE email=? LIMIT 1",
      [email]
    );
    const ownerId = Number(createdRows?.[0]?.id || 0) || null;
    console.info("[auth-bootstrap-owner]", {
      action: "create_additional_env_owner",
      user_id: ownerId,
      email,
      at: new Date().toISOString(),
    });
    return {
      ok: true,
      created: true,
      owner_id: ownerId,
      owner_email: email,
    };
  }

  const [insertResult] = await pool.query(
    "INSERT INTO users (email,password,role,managed_by_user_id) VALUES (?,?,'owner',NULL)",
    [email, passwordHash]
  );
  const ownerId = Number(insertResult?.insertId || 0) || null;
  console.info("[auth-bootstrap-owner]", {
    action: "create_owner_from_env",
    user_id: ownerId,
    email,
    at: new Date().toISOString(),
  });
  return {
    ok: true,
    created: true,
    owner_id: ownerId,
    owner_email: email,
  };
}
