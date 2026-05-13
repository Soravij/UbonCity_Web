import "dotenv/config";
import { resolveSmokeActor } from "./shared-smoke-auth.mjs";

const BASE_URL = String(process.env.COLLECTOR_PHASEF_SMOKE_BASE_URL || "http://127.0.0.1:5062").trim();
const ACTOR = resolveSmokeActor({
  label: "phase F lifecycle authority smoke",
  emailEnvKeys: ["COLLECTOR_PHASEF_SMOKE_EMAIL", "BACKEND_AUTH_EMAIL", "COLLECTOR_TEST_EMAIL"],
  passwordEnvKeys: ["COLLECTOR_PHASEF_SMOKE_PASSWORD", "BACKEND_AUTH_PASSWORD", "COLLECTOR_TEST_PASSWORD"],
  userIdEnvKeys: ["COLLECTOR_TEST_USER_ID"],
  roleEnvKeys: ["COLLECTOR_TEST_USER_ROLE"],
  displayNameEnvKeys: ["COLLECTOR_TEST_USER_NAME"],
  defaultRole: "owner",
});

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
  const health = await requestJson("/api/health");
  assert(health.response.ok && health.payload?.ok === true, `collector health failed at ${BASE_URL}/api/health`);

  const token = ACTOR.token
    ? String(ACTOR.token)
    : await (async () => {
      const login = await requestJson("/api/auth/login", {
        method: "POST",
        body: { email: ACTOR.email, password: ACTOR.password },
      });
      assert(login.response.ok && login.payload?.token, `collector login failed: ${JSON.stringify(login.payload)}`);
      return String(login.payload.token);
    })();

  const createUser = await requestJson("/api/users", {
    method: "POST",
    token,
    body: {
      email: "phasef-created-user@local.test",
      password: "PhaseF_User_123!",
      role: "freelance",
      managed_by_user_id: 1,
    },
  });
  assert(createUser.response.status === 409, `expected /api/users 409: ${JSON.stringify(createUser.payload)}`);
  assert(createUser.payload?.code === "LIFECYCLE_MUTATION_MOVED", `unexpected /api/users code: ${JSON.stringify(createUser.payload)}`);

  const updateRole = await requestJson("/api/users/999/role", {
    method: "PATCH",
    token,
    body: { role: "admin", managed_by_user_id: null },
  });
  assert(updateRole.response.status === 409, `expected /api/users/:id/role 409: ${JSON.stringify(updateRole.payload)}`);
  assert(updateRole.payload?.code === "LIFECYCLE_MUTATION_MOVED", `unexpected /api/users/:id/role code: ${JSON.stringify(updateRole.payload)}`);

  const deleteUser = await requestJson("/api/users/999", {
    method: "DELETE",
    token,
  });
  assert(deleteUser.response.status === 409, `expected /api/users/:id DELETE 409: ${JSON.stringify(deleteUser.payload)}`);
  assert(deleteUser.payload?.code === "LIFECYCLE_MUTATION_MOVED", `unexpected /api/users/:id DELETE code: ${JSON.stringify(deleteUser.payload)}`);

  console.log(JSON.stringify({
    ok: true,
    scope: "collector",
    assertions: [
      "POST /api/users rejected",
      "PATCH /api/users/:id/role rejected",
      "DELETE /api/users/:id rejected",
    ],
  }, null, 2));
}

main().catch((err) => {
  console.error(`smoke-lifecycle-authority-phasef: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
