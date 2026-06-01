import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readCliOption(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] ?? "").trim();
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const PID_FILE = process.env.BACKEND_PID_FILE
  ? path.resolve(process.env.BACKEND_PID_FILE)
  : path.join(CWD, "runtime", "backend-server.pid");

function resolveBaseUrlFromHostPort(rawHost, rawPort) {
  const port = Number(rawPort || 0) || 5060;
  const bindHost = String(rawHost || "127.0.0.1").trim() || "127.0.0.1";
  const host = bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost;
  return `http://${host}:${port}`;
}

function resolveHealthBaseUrl(pidInfo = null) {
  const explicitUrl = readCliOption("--url") || process.env.BACKEND_HEALTH_URL || "";
  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/, "");
  }
  if (pidInfo?.port) {
    return resolveBaseUrlFromHostPort(pidInfo.bind_host, pidInfo.port);
  }
  return resolveBaseUrlFromHostPort(process.env.COLLECTOR_BIND_HOST, process.env.PORT);
}

async function readPidInfo() {
  try {
    const raw = await fs.readFile(PID_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const pidInfo = await readPidInfo();
  const baseUrl = resolveHealthBaseUrl(pidInfo);
  const response = await fetch(`${baseUrl}/api/health`);
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true) {
    throw new Error(`health check failed: ${JSON.stringify(payload)}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        base_url: baseUrl,
        service: payload?.service || null,
        pid: Number(pidInfo?.pid || 0) || null,
        managed_process_detected: Boolean(Number(pidInfo?.pid || 0)),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(`backend-health: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
