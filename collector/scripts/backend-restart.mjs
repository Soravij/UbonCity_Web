import "dotenv/config";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const PID_FILE = process.env.BACKEND_PID_FILE
  ? path.resolve(process.env.BACKEND_PID_FILE)
  : path.join(CWD, "runtime", "backend-server.pid");
const LOG_FILE = process.env.BACKEND_LOG_FILE
  ? path.resolve(process.env.BACKEND_LOG_FILE)
  : path.join(CWD, "runtime", "backend-server.out.log");
const ERR_FILE = process.env.BACKEND_ERR_FILE
  ? path.resolve(process.env.BACKEND_ERR_FILE)
  : path.join(CWD, "runtime", "backend-server.err.log");
const STOP_FILE = process.env.BACKEND_STOP_FILE
  ? path.resolve(process.env.BACKEND_STOP_FILE)
  : `${PID_FILE}.stop`;
const PORT = Number(process.env.PORT || 5060) || 5060;
const BIND_HOST = String(process.env.COLLECTOR_BIND_HOST || "127.0.0.1").trim() || "127.0.0.1";
const HEALTH_URL = `http://${BIND_HOST === "0.0.0.0" ? "127.0.0.1" : BIND_HOST}:${PORT}/api/health`;
const START_TIMEOUT_MS = Math.max(5_000, Number(process.env.BACKEND_RESTART_TIMEOUT_MS || 30_000) || 30_000);

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePathText(value) {
  return normalizeText(value).replace(/\\/g, "/").toLowerCase();
}

async function removeFile(filePath) {
  await fs.rm(filePath, { force: true });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !["ESRCH"].includes(String(err?.code || ""));
  }
}

async function readWindowsProcessMetadata(pid) {
  const psScript = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
    "if ($null -eq $p) { exit 3 }",
    "[PSCustomObject]@{ commandLine=$p.CommandLine; executablePath=$p.ExecutablePath; creationDate=$p.CreationDate } | ConvertTo-Json -Compress",
  ].join("; ");

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", psScript], {
    windowsHide: true,
  }).catch((error) => {
    if (Number(error?.code) === 3) {
      return { stdout: "" };
    }
    throw error;
  });

  const raw = normalizeText(stdout);
  if (!raw) return null;
  return JSON.parse(raw);
}

function isCollectorServerProcess(processMeta) {
  const commandLine = normalizePathText(processMeta?.commandLine);
  const executablePath = normalizePathText(processMeta?.executablePath);
  const expectedScript = normalizePathText(path.join(CWD, "server", "index.mjs"));
  return Boolean(
    commandLine
    && executablePath
    && executablePath.endsWith("/node.exe")
    && (commandLine.includes(expectedScript) || commandLine.includes("server/index.mjs"))
  );
}

async function findListeningPidByPort(port) {
  if (process.platform !== "win32") return 0;
  const psScript = [
    `$conn = Get-NetTCPConnection -LocalPort ${Number(port || 0)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    "if ($null -eq $conn) { exit 3 }",
    "Write-Output $conn.OwningProcess",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", psScript], {
    windowsHide: true,
  }).catch((error) => {
    if (Number(error?.code) === 3) {
      return { stdout: "" };
    }
    throw error;
  });
  return Number.parseInt(normalizeText(stdout), 10) || 0;
}

async function stopManagedProcessIfPresent() {
  if (!fsSync.existsSync(PID_FILE)) return;
  try {
    await execFileAsync(process.execPath, ["scripts/backend-stop.mjs"], {
      cwd: CWD,
      env: process.env,
      windowsHide: true,
    });
  } catch (error) {
    const stderr = normalizeText(error?.stderr || error?.stdout || error?.message || "");
    if (!stderr.includes("pid file not found")) {
      throw new Error(`backend-stop failed: ${stderr || "unknown error"}`);
    }
  }
}

async function stopStaleCollectorListener() {
  const pid = await findListeningPidByPort(PORT);
  if (!pid || !isProcessAlive(pid)) return;
  const processMeta = process.platform === "win32"
    ? await readWindowsProcessMetadata(pid)
    : null;
  if (process.platform === "win32" && !isCollectorServerProcess(processMeta)) {
    throw new Error(`port ${PORT} is in use by a non-collector process (pid ${pid})`);
  }
  await execFileAsync("taskkill", ["/PID", String(pid), "/F"], {
    windowsHide: true,
  });
  await delay(500);
}

async function writePidFile(pid) {
  await fs.mkdir(path.dirname(PID_FILE), { recursive: true });
  await fs.writeFile(
    PID_FILE,
    JSON.stringify(
      {
        pid: Number(pid || 0),
        port: PORT,
        bind_host: BIND_HOST,
        log_file: LOG_FILE,
        err_file: ERR_FILE,
        stop_file: STOP_FILE,
        manager_pid: Number(process.pid || 0),
        management_mode: "background_restart",
        ready_mode: "restart",
        server_exec_path: process.execPath,
        server_script: path.join(CWD, "server", "index.mjs"),
        server_args: ["server/index.mjs"],
        started_at: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
}

async function waitForHealth(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(HEALTH_URL);
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok === true) {
        return payload;
      }
    } catch {}
    await delay(500);
  }
  throw new Error(`collector health check timed out at ${HEALTH_URL}`);
}

async function startCollectorInBackground() {
  await fs.mkdir(path.dirname(LOG_FILE), { recursive: true });
  await fs.writeFile(LOG_FILE, "", "utf8");
  await fs.writeFile(ERR_FILE, "", "utf8");
  const stdoutFd = fsSync.openSync(LOG_FILE, "a");
  const stderrFd = fsSync.openSync(ERR_FILE, "a");
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: CWD,
    env: process.env,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  child.unref();
  fsSync.closeSync(stdoutFd);
  fsSync.closeSync(stderrFd);
  await writePidFile(child.pid);
  return child.pid;
}

async function cleanupFailedStart(pid) {
  if (pid && isProcessAlive(pid)) {
    try {
      await execFileAsync("taskkill", ["/PID", String(pid), "/F"], {
        windowsHide: true,
      });
    } catch {}
  }
  await removeFile(PID_FILE);
  await removeFile(STOP_FILE);
}

async function main() {
  await stopManagedProcessIfPresent();
  await stopStaleCollectorListener();
  await removeFile(STOP_FILE);

  const pid = await startCollectorInBackground();
  try {
    const payload = await waitForHealth(START_TIMEOUT_MS);
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: "backend_restart",
          pid,
          port: PORT,
          bind_host: BIND_HOST,
          health_url: HEALTH_URL,
          health: payload,
          log_file: LOG_FILE,
          err_file: ERR_FILE,
        },
        null,
        2
      )
    );
  } catch (error) {
    await cleanupFailedStart(pid);
    throw error;
  }
}

main().catch((err) => {
  console.error(`backend-restart: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
