import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CWD = path.resolve(SCRIPT_DIR, "..");
const PID_FILE = process.env.BACKEND_PID_FILE
  ? path.resolve(process.env.BACKEND_PID_FILE)
  : path.join(CWD, "runtime", "backend-server.pid");
const STOP_FILE = process.env.BACKEND_STOP_FILE
  ? path.resolve(process.env.BACKEND_STOP_FILE)
  : `${PID_FILE}.stop`;

async function readPidInfo() {
  const raw = await fs.readFile(PID_FILE, "utf8");
  return JSON.parse(raw);
}

async function removePidFile() {
  await fs.rm(PID_FILE, { force: true });
}

async function writeStopFile(pidInfo, pid) {
  await fs.mkdir(path.dirname(STOP_FILE), { recursive: true });
  await fs.writeFile(
    STOP_FILE,
    JSON.stringify(
      {
        pid,
        requested_at: new Date().toISOString(),
        management_mode: pidInfo?.management_mode || "backend_ready",
      },
      null,
      2
    ),
    "utf8"
  );
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !["ESRCH"].includes(String(err?.code || ""));
  }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizePathText(value) {
  return normalizeText(value).replace(/\\/g, "/").toLowerCase();
}

async function readWindowsProcessMetadata(pid) {
  const psScript = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue`,
    "if ($null -eq $p) { exit 3 }",
    "[PSCustomObject]@{ commandLine=$p.CommandLine; executablePath=$p.ExecutablePath; creationDate=$p.CreationDate } | ConvertTo-Json -Compress",
  ].join("; ");

  return await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", psScript], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    child.on("error", (err) => {
      reject(new Error(`process metadata lookup failed to start: ${String(err?.message || err)}`));
    });
    child.on("exit", (code) => {
      if (code === 3) {
        resolve(null);
        return;
      }
      if (code !== 0) {
        reject(new Error(`process metadata lookup failed with code ${code}: ${normalizeText(stderr) || "(no stderr)"}`));
        return;
      }
      const raw = normalizeText(stdout);
      if (!raw) {
        reject(new Error("process metadata lookup returned empty output"));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`process metadata lookup returned invalid JSON: ${String(err?.message || err)}`));
      }
    });
  });
}

function validateManagedProcess(pidInfo, processMeta) {
  if (!processMeta || typeof processMeta !== "object") {
    return { ok: false, reason: "process metadata is unavailable" };
  }

  const commandLine = normalizePathText(processMeta.commandLine);
  const executablePath = normalizePathText(processMeta.executablePath);
  const expectedExecPath = normalizePathText(pidInfo?.server_exec_path);
  const expectedScriptPath = normalizePathText(pidInfo?.server_script);
  const expectedArgs = Array.isArray(pidInfo?.server_args)
    ? pidInfo.server_args.map((value) => normalizePathText(value)).filter(Boolean)
    : [];

  if (!commandLine) {
    return { ok: false, reason: "process command line is unavailable" };
  }

  if (expectedExecPath && executablePath && expectedExecPath !== executablePath) {
    return {
      ok: false,
      reason: `executable mismatch (expected ${expectedExecPath}, got ${executablePath})`,
    };
  }

  if (expectedScriptPath && !commandLine.includes(expectedScriptPath)) {
    const scriptName = normalizePathText(path.basename(expectedScriptPath));
    const hasExpectedArg = expectedArgs.some((arg) => commandLine.includes(arg));
    if (hasExpectedArg || (scriptName && commandLine.includes(scriptName))) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `command line mismatch (expected script ${expectedScriptPath})`,
    };
  }

  if (!expectedScriptPath && expectedArgs.length > 0) {
    const missingArg = expectedArgs.find((arg) => !commandLine.includes(arg));
    if (missingArg) {
      return {
        ok: false,
        reason: `command line mismatch (expected arg ${missingArg})`,
      };
    }
  }

  if (!expectedScriptPath && expectedArgs.length === 0 && !expectedExecPath) {
    return { ok: false, reason: "pid file does not contain process identity metadata" };
  }

  return { ok: true };
}

async function ensureManagedProcessIdentity(pidInfo, pid) {
  if (process.platform !== "win32") {
    return;
  }

  const processMeta = await readWindowsProcessMetadata(pid);
  if (!processMeta) {
    throw new Error(`unable to inspect process metadata for pid ${pid}`);
  }
  const validation = validateManagedProcess(pidInfo, processMeta);
  if (!validation.ok) {
    throw new Error(`refusing to stop pid ${pid}: ${validation.reason}`);
  }
}

async function main() {
  let pidInfo;
  try {
    pidInfo = await readPidInfo();
  } catch {
    throw new Error("pid file not found. Start backend with npm run backend:ready first.");
  }

  const pid = Number(pidInfo?.pid || 0);
  if (!pid) {
    await removePidFile();
    throw new Error("pid file is invalid");
  }

  if (!isProcessAlive(pid)) {
    await removePidFile();
    console.log(`backend-stop: pid ${pid} was not running; removed stale pid file`);
    return;
  }

  await ensureManagedProcessIdentity(pidInfo, pid);
  await writeStopFile(pidInfo, pid);

  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 20; i += 1) {
    await delay(250);
    if (!isProcessAlive(pid)) {
      await removePidFile();
      console.log(`backend-stop: stopped pid ${pid}`);
      return;
    }
  }

  process.kill(pid, "SIGKILL");
  await delay(250);
  await removePidFile();
  console.log(`backend-stop: force-stopped pid ${pid}`);
}

main().catch((err) => {
  console.error(`backend-stop: FAILED - ${String(err?.message || err)}`);
  process.exitCode = 1;
});
