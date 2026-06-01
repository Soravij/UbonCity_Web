import "dotenv/config";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const PORT = Number(process.env.BACKEND_REVIEW_ACCESS_SMOKE_PORT || 5102);
const BASE_URL = `http://127.0.0.1:${PORT}/api`;
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
      id: 999997,
      email: "synthetic-review-access-owner@local.test",
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

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await requestJson("/health");
      if (res.response.ok) return true;
    } catch {}
    await delay(250);
  }
  throw new Error("backend health check timeout");
}

async function startBackend() {
  const child = spawn("node", ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      BACKEND_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
    },
    stdio: "pipe",
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  await waitForHealth();
  return child;
}

async function stopBackend(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3000),
  ]);
}

async function startMediaFixtureServer() {
  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmJ0AAAAASUVORK5CYII=",
    "base64"
  );
  const server = http.createServer((req, res) => {
    if (req.url === "/tiny.png") {
      res.writeHead(200, { "content-type": "image/png", "content-length": imageBytes.length });
      res.end(imageBytes);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  assert(port > 0, "media fixture port unavailable");
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function run() {
  assert(JWT_SECRET, "JWT_SECRET is required");
  assert(DB_USER && DB_NAME, "DB_USER and DB_NAME are required");
  const ownerToken = createOwnerToken();
  const backend = await startBackend();
  const fixture = await startMediaFixtureServer();
  const sourceId = Number(`98${Date.now().toString().slice(-10)}`);
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

    const ingest = await requestJson("/review-content/ingest", {
      method: "POST",
      token: ownerToken,
      body: {
        source_system: "collector-app",
        source_content_item_id: sourceId,
        source_base_url: fixture.baseUrl,
        content: {
          content_type: "place",
          lang: "th",
          category: "restaurants",
          title: `Smoke Review Access ${sourceId}`,
          body: "Smoke review access body",
          meta_title: "Smoke review access meta title",
          meta_description: "Smoke review access meta description",
        },
        media_manifest: {
          cover: { source_url: `${fixture.baseUrl}/tiny.png`, role: "cover", selected: true },
          gallery: [],
          inline: [],
        },
      },
    });
    assert(ingest.response.ok, `ingest failed: ${JSON.stringify(ingest.payload)}`);
    reviewId = Number(ingest.payload?.item?.id || 0) || 0;
    assert(reviewId > 0, "review id missing");

    const tokenRes = await requestJson(`/review-content/${reviewId}/access-token`, {
      method: "POST",
      token: ownerToken,
      body: {},
    });
    assert(tokenRes.response.ok, `access token creation failed: ${JSON.stringify(tokenRes.payload)}`);
    const accessToken = String(tokenRes.payload?.access_token || "").trim();
    assert(accessToken, "scoped review access token missing");

    const detailOk = await requestJson(`/review-content/${reviewId}`, {
      token: accessToken,
    });
    assert(detailOk.response.ok, `scoped token read failed: ${JSON.stringify(detailOk.payload)}`);
    assert(
      Number(detailOk.payload?.item?.id || 0) === reviewId,
      `scoped token returned wrong review: ${JSON.stringify(detailOk.payload)}`
    );

    const detailForbidden = await requestJson(`/review-content/${reviewId + 1}`, {
      token: accessToken,
    });
    assert(
      detailForbidden.response.status === 403 || detailForbidden.response.status === 404,
      `scoped token must not read other review id: ${detailForbidden.response.status} ${JSON.stringify(detailForbidden.payload)}`
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          scope: "review-access-token",
          base_url: BASE_URL,
          review_id: reviewId,
          assertions: [
            "ingest review content by editor/admin token",
            "issue short-lived scoped review access token",
            "scoped token can read only its review id",
          ],
        },
        null,
        2
      )
    );
  } finally {
    try {
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
      await fixture.close();
    } finally {
      await stopBackend(backend);
    }
  }
}

run().catch((err) => {
  console.error(`smoke-review-access-token: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
