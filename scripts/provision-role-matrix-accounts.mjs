import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "..");

const BACKEND_BASE_URL = String(process.env.COLLECTOR_SYNC_BACKEND_API || "http://127.0.0.1:5000/api").trim().replace(/\/+$/, "");
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || "").trim().toLowerCase();
const OWNER_PASSWORD = String(process.env.OWNER_PASSWORD || "");
const TOKEN_CACHE_PATH = path.join(WORKSPACE_ROOT, "scripts", "tmp-role-matrix-tokens.json");
const TEST_PREFIX = "__test-rolematrix-";
const TEST_PASSWORD = "RoleMatrix_123!";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nowIso() {
  return new Date().toISOString();
}

function logStep(step, detail = "") {
  console.error(`[${nowIso()}] provision step=${step}${detail ? ` ${detail}` : ""}`);
}

function userIdFromToken(token) {
  const seg = String(token).split(".")[1];
  const json = JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
  return Number(json.id ?? json.userId ?? json.sub ?? 0) || 0;
}

async function requestJson(url, { method = "POST", token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, ok: response.ok, payload };
}

async function main() {
  assert(OWNER_EMAIL, "OWNER_EMAIL env required");
  assert(OWNER_PASSWORD, "OWNER_PASSWORD env required");

  const runSuffix = Date.now().toString(36);
  const accounts = {
    owner: { email: OWNER_EMAIL, password: OWNER_PASSWORD, role: "owner", token: "", userId: 0 },
    admin: { email: `${TEST_PREFIX}admin-${runSuffix}@e.test`, password: TEST_PASSWORD, role: "admin", token: "", userId: 0 },
    manager: { email: `${TEST_PREFIX}manager-${runSuffix}@e.test`, password: TEST_PASSWORD, role: "user", token: "", userId: 0 },
    editorA: { email: `${TEST_PREFIX}editorA-${runSuffix}@e.test`, password: TEST_PASSWORD, role: "editor", token: "", userId: 0 },
    editorB: { email: `${TEST_PREFIX}editorB-${runSuffix}@e.test`, password: TEST_PASSWORD, role: "editor", token: "", userId: 0 },
    freelance: { email: `${TEST_PREFIX}freelance-${runSuffix}@e.test`, password: TEST_PASSWORD, role: "freelance", token: "", userId: 0 },
  };

  try {
    logStep("owner.login");
    const ownerLogin = await requestJson(`${BACKEND_BASE_URL}/login`, {
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
    });
    assert(ownerLogin.ok, `owner login failed: ${JSON.stringify(ownerLogin.payload)}`);
    accounts.owner.token = ownerLogin.payload.token;
    accounts.owner.userId = userIdFromToken(ownerLogin.payload.token);
    assert(accounts.owner.userId > 0, "owner userId missing");

    logStep("create.admin");
    const adminCreate = await requestJson(`${BACKEND_BASE_URL}/users`, {
      token: accounts.owner.token,
      body: { email: accounts.admin.email, password: accounts.admin.password, role: "admin" },
    });
    assert(adminCreate.ok, `admin create failed: ${JSON.stringify(adminCreate.payload)}`);
    accounts.admin.userId = Number(adminCreate.payload.user?.id || 0) || 0;
    logStep("admin.created", `userId=${accounts.admin.userId}`);

    logStep("create.manager");
    const managerCreate = await requestJson(`${BACKEND_BASE_URL}/users`, {
      token: accounts.owner.token,
      body: { email: accounts.manager.email, password: accounts.manager.password, role: "user" },
    });
    assert(managerCreate.ok, `manager create failed: ${JSON.stringify(managerCreate.payload)}`);
    accounts.manager.userId = Number(managerCreate.payload.user?.id || 0) || 0;
    logStep("manager.created", `userId=${accounts.manager.userId}`);

    logStep("manager.login (required before creating subordinates)");
    const managerLogin = await requestJson(`${BACKEND_BASE_URL}/login`, {
      body: { email: accounts.manager.email, password: accounts.manager.password },
    });
    assert(managerLogin.ok, `manager login failed: ${JSON.stringify(managerLogin.payload)}`);
    accounts.manager.token = managerLogin.payload.token;
    logStep("manager.logged_in");

    logStep("create.editorA (managed by manager)");
    const editorACreate = await requestJson(`${BACKEND_BASE_URL}/users`, {
      token: accounts.manager.token,
      body: { email: accounts.editorA.email, password: accounts.editorA.password, role: "editor" },
    });
    assert(editorACreate.ok, `editorA create failed: ${JSON.stringify(editorACreate.payload)}`);
    accounts.editorA.userId = Number(editorACreate.payload.user?.id || 0) || 0;
    logStep("editorA.created", `userId=${accounts.editorA.userId}`);

    logStep("create.editorB (managed by manager)");
    const editorBCreate = await requestJson(`${BACKEND_BASE_URL}/users`, {
      token: accounts.manager.token,
      body: { email: accounts.editorB.email, password: accounts.editorB.password, role: "editor" },
    });
    assert(editorBCreate.ok, `editorB create failed: ${JSON.stringify(editorBCreate.payload)}`);
    accounts.editorB.userId = Number(editorBCreate.payload.user?.id || 0) || 0;
    logStep("editorB.created", `userId=${accounts.editorB.userId}`);

    logStep("create.freelance (managed by manager)");
    const freelanceCreate = await requestJson(`${BACKEND_BASE_URL}/users`, {
      token: accounts.manager.token,
      body: { email: accounts.freelance.email, password: accounts.freelance.password, role: "freelance" },
    });
    assert(freelanceCreate.ok, `freelance create failed: ${JSON.stringify(freelanceCreate.payload)}`);
    accounts.freelance.userId = Number(freelanceCreate.payload.user?.id || 0) || 0;
    logStep("freelance.created", `userId=${accounts.freelance.userId}`);

    logStep("login.all.remaining");
    for (const key of ["admin", "editorA", "editorB", "freelance"]) {
      const login = await requestJson(`${BACKEND_BASE_URL}/login`, {
        body: { email: accounts[key].email, password: accounts[key].password },
      });
      assert(login.ok, `${key} login failed: ${JSON.stringify(login.payload)}`);
      accounts[key].token = login.payload.token;
      accounts[key].userId = accounts[key].userId || userIdFromToken(login.payload.token);
      logStep(`${key}.logged_in`);
    }

    const tokenMap = {};
    for (const [key, acct] of Object.entries(accounts)) {
      tokenMap[key] = { email: acct.email, role: acct.role, userId: acct.userId, token: acct.token };
    }

    await fs.mkdir(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
    await fs.writeFile(TOKEN_CACHE_PATH, JSON.stringify(tokenMap, null, 2));

    console.log(JSON.stringify({
      ok: true,
      token_cache: TOKEN_CACHE_PATH,
      accounts: Object.fromEntries(
        Object.entries(accounts).map(([k, v]) => [k, { email: v.email, role: v.role, userId: v.userId }])
      ),
    }, null, 2));
  } catch (err) {
    console.error(`provision FAILED: ${String(err?.message || err)}`);
    process.exitCode = 1;
  }
}

main();
