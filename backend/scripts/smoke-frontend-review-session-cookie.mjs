import "dotenv/config";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const BACKEND_PORT = Number(process.env.BACKEND_FRONTEND_REVIEW_SESSION_SMOKE_BACKEND_PORT || 5110);
const FRONTEND_PORT = Number(process.env.BACKEND_FRONTEND_REVIEW_SESSION_SMOKE_FRONTEND_PORT || 3110);
const BACKEND_BASE_URL = `http://127.0.0.1:${BACKEND_PORT}/api`;
const FRONTEND_BASE_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
const JWT_ISSUER = String(process.env.JWT_ISSUER || "uboncity-backend").trim();
const JWT_AUDIENCE_BACKEND = String(process.env.JWT_AUDIENCE_BACKEND || "uboncity-backend").trim();
const DB_HOST = String(process.env.DB_HOST || "127.0.0.1");
const DB_USER = String(process.env.DB_USER || "");
const DB_PASSWORD = String(process.env.DB_PASSWORD || "");
const DB_NAME = String(process.env.DB_NAME || "");
const DB_PORT = Number(process.env.DB_PORT || 3306);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createOwnerToken() {
  return jwt.sign(
    {
      id: 999996,
      email: "synthetic-review-session-owner@local.test",
      role: "owner",
      managed_by_backend_user_id: null,
    },
    JWT_SECRET,
    {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE_BACKEND,
      expiresIn: "10m",
    }
  );
}

async function requestJson(url, { method = "GET", token = "", body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
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

async function waitForHttpOk(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch {}
    await delay(300);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function startBackend() {
  return spawn("node", ["server.js"], {
    cwd: "D:\\UbonCity_Web\\backend",
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      BACKEND_PUBLIC_URL: `http://127.0.0.1:${BACKEND_PORT}`,
    },
    stdio: "pipe",
  });
}

function startFrontend() {
  return spawn("cmd.exe", ["/c", "npm.cmd", "run", "start", "--", "-p", String(FRONTEND_PORT)], {
    cwd: "D:\\UbonCity_Web\\frontend",
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: BACKEND_BASE_URL,
    },
    stdio: "pipe",
  });
}

async function stopProcess(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(2500).then(() => false),
  ]);
  if (exited) return;

  const pid = Number(child.pid || 0) || 0;
  if (pid > 0) {
    await new Promise((resolve) => {
      const killer = spawn("cmd.exe", ["/c", "taskkill", "/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
  }
}

async function run() {
  assert(JWT_SECRET, "JWT_SECRET is required");
  assert(DB_USER && DB_NAME, "DB_USER and DB_NAME are required");
  const ownerToken = createOwnerToken();
  const backend = startBackend();
  const frontend = startFrontend();
  const sourceId = Number(`97${Date.now().toString().slice(-10)}`);
  let db = null;
  let reviewId = 0;
  try {
    db = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      port: DB_PORT,
    });

    await waitForHttpOk(`${BACKEND_BASE_URL}/health`);
    await waitForHttpOk(`${FRONTEND_BASE_URL}`);

    const ingest = await requestJson(`${BACKEND_BASE_URL}/review-content/ingest`, {
      method: "POST",
      token: ownerToken,
      body: {
        source_system: "collector-app",
        source_content_item_id: sourceId,
        source_base_url: FRONTEND_BASE_URL,
        content: {
          content_type: "place",
          lang: "th",
          category: "restaurants",
          title: `Smoke Review Session ${sourceId}`,
          body: "Smoke review session body",
          meta_title: "Smoke review session meta title",
          meta_description: "Smoke review session meta description",
        },
        media_manifest: {
          cover: null,
          gallery: [],
          inline: [],
        },
      },
    });
    assert(ingest.response.ok, `ingest failed: ${JSON.stringify(ingest.payload)}`);
    reviewId = Number(ingest.payload?.item?.id || 0) || 0;
    assert(reviewId > 0, "review id missing");

    const accessRes = await requestJson(`${BACKEND_BASE_URL}/review-content/${reviewId}/access-token`, {
      method: "POST",
      token: ownerToken,
      body: {},
    });
    assert(accessRes.response.ok, `access token create failed: ${JSON.stringify(accessRes.payload)}`);
    const accessToken = String(accessRes.payload?.access_token || "").trim();
    const expiresIn = Number(accessRes.payload?.expires_in || 0) || 0;
    assert(accessToken, "missing review access token");
    assert(expiresIn > 0, "missing expires_in");

    const form = new FormData();
    form.set("review_id", String(reviewId));
    form.set("lang", "th");
    form.set("access_token", accessToken);
    form.set("expires_in", String(expiresIn));

    const sessionRes = await fetch(`${FRONTEND_BASE_URL}/api/review-session`, {
      method: "POST",
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
    assert(sessionRes.status === 303, `review-session expected 303, got ${sessionRes.status}`);
    const locationHeader = String(sessionRes.headers.get("location") || "");
    assert(locationHeader.includes(`/th/review/${reviewId}`), `review-session location mismatch: ${locationHeader}`);
    const setCookie = String(sessionRes.headers.get("set-cookie") || "");
    assert(setCookie.includes(`review_access_${reviewId}=`), `cookie name mismatch: ${setCookie}`);
    assert(setCookie.toLowerCase().includes("httponly"), `cookie must be HttpOnly: ${setCookie}`);

    const pageRes = await fetch(`${FRONTEND_BASE_URL}/th/review/${reviewId}`, {
      headers: { cookie: setCookie.split(";")[0] },
      signal: AbortSignal.timeout(20000),
    });
    assert(pageRes.ok, `review page failed with cookie: ${pageRes.status}`);
    const pageHtml = await pageRes.text();
    assert(
      pageHtml.includes("Review Mode: this page is rendered from pending review content"),
      "review page did not render review mode marker"
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          scope: "frontend-review-session-cookie",
          backend_base_url: BACKEND_BASE_URL,
          frontend_base_url: FRONTEND_BASE_URL,
          review_id: reviewId,
          assertions: [
            "review-session route responds with 303 redirect",
            "review-session sets HttpOnly scoped cookie",
            "review page renders with cookie-backed scoped token",
          ],
        },
        null,
        2
      )
    );
  } finally {
    if (db && reviewId > 0) {
      const [assetRows] = await db.query(
        "SELECT storage_path, file_name FROM review_content_assets WHERE review_content_id=?",
        [reviewId]
      );
      for (const row of Array.isArray(assetRows) ? assetRows : []) {
        const relative = String(row?.storage_path || "").trim().replace(/\\/g, "/");
        const fileName = String(row?.file_name || "").trim();
        const resolved = relative.startsWith("uploads/")
          ? path.join(process.cwd(), relative)
          : fileName
            ? path.join(process.cwd(), "uploads", fileName)
            : "";
        if (!resolved) continue;
        try {
          await fs.unlink(resolved);
        } catch {}
      }
      await db.query("DELETE FROM review_actions WHERE review_content_id=?", [reviewId]);
      await db.query("DELETE FROM review_content_assets WHERE review_content_id=?", [reviewId]);
      await db.query("DELETE FROM review_contents WHERE id=?", [reviewId]);
    }
    if (db) await db.end();
    await stopProcess(frontend);
    await stopProcess(backend);
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`smoke-frontend-review-session-cookie: FAILED - ${String(err?.message || err)}`);
    process.exit(1);
  });
