const BACKEND = process.env.SMOKE_BACKEND || "https://api-test.uboncity.com";
const COLLECTOR = process.env.SMOKE_COLLECTOR || "http://127.0.0.1:5070";
const EMAIL = process.env.SMOKE_EMAIL || "";
const PASSWORD = process.env.SMOKE_PASSWORD || "";

let pass = 0, fail = 0;
const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    pass++; results.push(`PASS ${name} ${detail || ""}`);
  } catch (e) {
    fail++; results.push(`FAIL ${name} ${e.message}`);
  }
}

async function get(url, headers = {}) {
  const r = await fetch(url, { headers });
  return { status: r.status, body: await r.text() };
}

let token = "";

await check("backend health", async () => {
  const r = await get(`${BACKEND}/api/health`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  return `status 200`;
});

await check("collector health", async () => {
  const r = await get(`${COLLECTOR}/api/health`);
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  return `status 200`;
});

await check("owner login", async () => {
  if (!EMAIL || !PASSWORD) throw new Error("SMOKE_EMAIL/SMOKE_PASSWORD not set");
  const r = await fetch(`${BACKEND}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const j = await r.json();
  if (!j.token) throw new Error("no token in response");
  if (j.role !== "owner") throw new Error(`role is ${j.role}`);
  token = j.token;
  return `role=${j.role}`;
});

await check("authed GET /api/users", async () => {
  if (!token) throw new Error("skipped, no token");
  const r = await get(`${BACKEND}/api/users`, { authorization: `Bearer ${token}` });
  if (r.status !== 200) throw new Error(`status ${r.status}`);
  const j = JSON.parse(r.body);
  if (!Array.isArray(j.items)) throw new Error("items not array");
  return `status 200 users=${j.items.length}`;
});

await check("no-auth rejected", async () => {
  const r = await get(`${BACKEND}/api/users`);
  if (r.status === 200) throw new Error("expected 401/403, got 200");
  return `status ${r.status}`;
});

for (const path of ["/api/categories", "/api/places", "/api/events", "/api/shortcuts"]) {
  await check(`public GET ${path}`, async () => {
    const r = await get(`${BACKEND}${path}`);
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    const j = JSON.parse(r.body);
    if (!Array.isArray(j.items)) throw new Error("items not array");
    return `status 200 count=${j.items.length}`;
  });
}

await check("backend readiness", async () => {
  const r = await get(`${BACKEND}/api/integrations/readiness`);
  return `status ${r.status}`;
});

await check("collector readiness", async () => {
  const r = await get(`${COLLECTOR}/api/integrations/readiness`);
  return `status ${r.status}`;
});

console.log(results.join("\n"));
console.log(`DEPLOY-SMOKE pass=${pass} fail=${fail}`);
process.exit(fail > 0 ? 1 : 0);
