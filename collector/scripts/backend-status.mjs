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

function resolveBaseUrl(pidInfo = null) {
  const explicitUrl = readCliOption("--url") || process.env.BACKEND_HEALTH_URL || "";
  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/, "");
  }
  if (pidInfo?.port) {
    return resolveBaseUrlFromHostPort(pidInfo.bind_host, pidInfo.port);
  }
  return resolveBaseUrlFromHostPort(process.env.COLLECTOR_BIND_HOST, process.env.PORT);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !["ESRCH"].includes(String(err?.code || ""));
  }
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
  const pid = Number(pidInfo?.pid || 0) || null;
  const baseUrl = resolveBaseUrl(pidInfo);
  const managedProcessRunning = pid ? isProcessAlive(pid) : false;

  let serviceReachable = false;
  let healthOk = false;
  let service = null;
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    serviceReachable = true;
    const payload = await response.json().catch(() => null);
    healthOk = response.ok && payload?.ok === true;
    service = payload?.service || null;
  } catch {
    serviceReachable = false;
    healthOk = false;
  }

  const managementMode = pidInfo?.management_mode || (pid ? "managed_pid_file" : "unmanaged");

  console.log(
    JSON.stringify(
      {
        ok: true,
        running: managedProcessRunning,
        managed_process_running: managedProcessRunning,
        service_reachable: serviceReachable,
        management_mode: managementMode,
        pid,
        base_url: baseUrl,
        health_ok: healthOk,
        service,
        pid_file: PID_FILE,
        log_file: pidInfo?.log_file || null,
        err_file: pidInfo?.err_file || null,
        started_at: pidInfo?.started_at || null,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(`backend-status: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
