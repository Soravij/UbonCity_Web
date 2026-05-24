import "dotenv/config";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";

const BASE_URL = String(process.env.BACKEND_PHASEF_SMOKE_BASE_URL || "http://127.0.0.1:5000").trim();
const DB_HOST = String(process.env.DB_HOST || "127.0.0.1");
const DB_USER = String(process.env.DB_USER || "");
const DB_PASSWORD = String(process.env.DB_PASSWORD || "");
const DB_NAME = String(process.env.DB_NAME || "");
const DB_PORT = Number(process.env.DB_PORT || 3306);

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const JWT_ISSUER = String(process.env.JWT_ISSUER || "uboncity-backend").trim();
const JWT_AUDIENCE_BACKEND = String(process.env.JWT_AUDIENCE_BACKEND || "uboncity-backend").trim();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function requestJson(pathname, { method = "GET", token = "", body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { response, payload };
}

async function main() {
  assert(DB_USER && DB_NAME, "DB_USER and DB_NAME must be set for backend phaseF smoke");
  assert(JWT_SECRET, "JWT_SECRET must be set for backend phaseF smoke");

  const runId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const ownerEmail = `phasef-owner-${runId}@local.test`;
  const ownerPassword = "PhaseF_Owner_123!";
  const adminEmail = `phasef-admin-${runId}@local.test`;
  const userEmail = `phasef-user-${runId}@local.test`;
  const editorEmail = `phasef-editor-${runId}@local.test`;
  const createdEmails = [
    ownerEmail,
    adminEmail,
    userEmail,
    editorEmail,
    `phasef-user-bad-${runId}@local.test`,
    `phasef-editor-bad-${runId}@local.test`,
  ];

  const db = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    port: DB_PORT,
  });

  try {
    const [healthResponse, healthPayload] = await (async () => {
      const result = await requestJson("/api/health");
      return [result.response, result.payload];
    })();
    assert(healthResponse.ok && healthPayload?.ok === true, `backend health failed at ${BASE_URL}/api/health`);

    const [managedByColumnRows] = await db.query("SHOW COLUMNS FROM users LIKE 'managed_by_user_id'");
    if (!Array.isArray(managedByColumnRows) || managedByColumnRows.length === 0) {
      await db.query("ALTER TABLE users ADD COLUMN managed_by_user_id BIGINT NULL AFTER role");
    }

    const ownerHash = await bcrypt.hash(ownerPassword, 10);
    const [insertOwner] = await db.execute(
      "INSERT INTO users (email,password,role,managed_by_user_id) VALUES (?,?,?,NULL)",
      [ownerEmail, ownerHash, "owner"]
    );
    const ownerId = Number(insertOwner?.insertId || 0);
    assert(ownerId > 0, "owner id missing");

    const ownerToken = jwt.sign(
      {
        id: ownerId,
        email: ownerEmail,
        role: "owner",
        managed_by_backend_user_id: null,
      },
      JWT_SECRET,
      {
        expiresIn: "10m",
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE_BACKEND,
      }
    );

    const ownerMe = await requestJson("/api/me", { token: ownerToken });
    assert(ownerMe.response.ok && Number(ownerMe.payload?.id || 0) === ownerId, `owner /me failed: ${JSON.stringify(ownerMe.payload)}`);

    const createAdmin = await requestJson("/api/users", {
      method: "POST",
      token: ownerToken,
      body: { email: adminEmail, password: "PhaseF_Admin_123!", role: "admin" },
    });
    assert(createAdmin.response.ok, `create admin failed: ${JSON.stringify(createAdmin.payload)}`);
    const adminId = Number(createAdmin.payload?.user?.id || 0);
    assert(adminId > 0, "admin id missing");

    const createUserBadManager = await requestJson("/api/users", {
      method: "POST",
      token: ownerToken,
      body: {
        email: `phasef-user-bad-${runId}@local.test`,
        password: "PhaseF_User_123!",
        role: "user",
        managed_by_user_id: ownerId,
      },
    });
    assert(
      !createUserBadManager.response.ok && createUserBadManager.response.status === 400,
      `expected create user bad manager to fail 400: ${JSON.stringify(createUserBadManager.payload)}`
    );

    const createUser = await requestJson("/api/users", {
      method: "POST",
      token: ownerToken,
      body: { email: userEmail, password: "PhaseF_User_123!", role: "user", managed_by_user_id: adminId },
    });
    assert(createUser.response.ok, `create user failed: ${JSON.stringify(createUser.payload)}`);
    const userId = Number(createUser.payload?.user?.id || 0);
    assert(userId > 0, "user id missing");

    const createEditorNoManager = await requestJson("/api/users", {
      method: "POST",
      token: ownerToken,
      body: { email: `phasef-editor-bad-${runId}@local.test`, password: "PhaseF_Editor_123!", role: "editor" },
    });
    assert(
      !createEditorNoManager.response.ok && createEditorNoManager.response.status === 400,
      `expected create editor without manager to fail 400: ${JSON.stringify(createEditorNoManager.payload)}`
    );

    const createEditor = await requestJson("/api/users", {
      method: "POST",
      token: ownerToken,
      body: { email: editorEmail, password: "PhaseF_Editor_123!", role: "editor", managed_by_user_id: userId },
    });
    assert(createEditor.response.ok, `create editor failed: ${JSON.stringify(createEditor.payload)}`);
    const editorId = Number(createEditor.payload?.user?.id || 0);
    assert(editorId > 0, "editor id missing");

    const promoteUserManager = await requestJson(`/api/users/${userId}/role`, {
      method: "PATCH",
      token: ownerToken,
      body: { role: "admin" },
    });
    assert(
      !promoteUserManager.response.ok && promoteUserManager.response.status === 400,
      `expected role transition guard fail 400: ${JSON.stringify(promoteUserManager.payload)}`
    );

    const deleteUserManager = await requestJson(`/api/users/${userId}`, {
      method: "DELETE",
      token: ownerToken,
    });
    assert(
      !deleteUserManager.response.ok && deleteUserManager.response.status === 400,
      `expected delete manager guard fail 400: ${JSON.stringify(deleteUserManager.payload)}`
    );

    const editorDetail = await requestJson(`/api/users/${editorId}`, { token: ownerToken });
    assert(editorDetail.response.ok, `get editor detail failed: ${JSON.stringify(editorDetail.payload)}`);
    assert(
      Number(editorDetail.payload?.user?.managed_by_user_id || 0) === userId,
      `editor manager mismatch from /users/:id: ${JSON.stringify(editorDetail.payload)}`
    );

    console.log(JSON.stringify({
      ok: true,
      scope: "backend",
      assertions: [
        "create user invalid manager rejected",
        "create editor no manager rejected",
        "role transition guard with dependents",
        "delete guard with dependents",
        "stored manager relationship is correct",
      ],
    }, null, 2));
  } finally {
    if (createdEmails.length > 0) {
      const placeholders = createdEmails.map(() => "?").join(",");
      await db.execute(`DELETE FROM users WHERE email IN (${placeholders})`, createdEmails);
    }
    await db.end();
  }
}

main().catch((err) => {
  console.error(`smoke-lifecycle-phasef: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
